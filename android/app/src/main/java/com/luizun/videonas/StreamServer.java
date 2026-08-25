package com.luizun.videonas;

import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import fi.iki.elonen.NanoHTTPD;

/**
 * Puente HTTP local: sirve los archivos del NAS (vía SMBJ) y las copias locales con el
 * MISMO contrato Range que videofile:// en el desktop (src/core/playback/http-range.ts
 * y tests/http-range.test.ts son la referencia): 206/416/200, Accept-Ranges,
 * Cache-Control: no-store. Solo escucha en 127.0.0.1 y exige el token de sesión.
 */
public class StreamServer extends NanoHTTPD {

    private static final Pattern RANGE_PATTERN = Pattern.compile("^bytes=(\\d*)-(\\d*)$");
    private static final Map<String, String> MIME_BY_EXTENSION = new HashMap<>();

    static {
        MIME_BY_EXTENSION.put(".mp4", "video/mp4");
        MIME_BY_EXTENSION.put(".m4v", "video/x-m4v");
        MIME_BY_EXTENSION.put(".mkv", "video/x-matroska");
        MIME_BY_EXTENSION.put(".webm", "video/webm");
        MIME_BY_EXTENSION.put(".avi", "video/x-msvideo");
        MIME_BY_EXTENSION.put(".mov", "video/quicktime");
        MIME_BY_EXTENSION.put(".mpg", "video/mpeg");
        MIME_BY_EXTENSION.put(".mpeg", "video/mpeg");
        MIME_BY_EXTENSION.put(".ts", "video/mp2t");
        MIME_BY_EXTENSION.put(".m2ts", "video/mp2t");
        MIME_BY_EXTENSION.put(".wmv", "video/x-ms-wmv");
        MIME_BY_EXTENSION.put(".flv", "video/x-flv");
    }

    private final SmbClientManager manager;
    private final String token;
    private final List<java.io.File> localRoots;

    public StreamServer(SmbClientManager manager, String token, List<java.io.File> localRoots) {
        super("127.0.0.1", 0); // puerto efímero; getListeningPort() da el real
        this.manager = manager;
        this.token = token;
        this.localRoots = localRoots;
    }

    static String mimeForPath(String path) {
        int dot = path.lastIndexOf('.');
        if (dot < 0) return "application/octet-stream";
        String mime = MIME_BY_EXTENSION.get(path.substring(dot).toLowerCase(Locale.ROOT));
        return mime != null ? mime : "application/octet-stream";
    }

    /** Port literal de parseRange de http-range.ts. null = sin cabecera o inválida. */
    static long[] parseRange(String rangeHeader, long fileSize) {
        if (rangeHeader == null) return null;
        Matcher matcher = RANGE_PATTERN.matcher(rangeHeader.trim());
        if (!matcher.matches()) return null;

        String startText = matcher.group(1);
        String endText = matcher.group(2);
        if (startText.isEmpty() && endText.isEmpty()) return null;

        long start;
        long end;
        try {
            if (startText.isEmpty()) {
                long suffixLength = Long.parseLong(endText);
                if (suffixLength <= 0) return null;
                start = Math.max(fileSize - suffixLength, 0);
                end = fileSize - 1;
            } else {
                start = Long.parseLong(startText);
                end = endText.isEmpty() ? fileSize - 1 : Long.parseLong(endText);
            }
        } catch (NumberFormatException e) {
            return null;
        }

        if (start < 0 || start > end || start >= fileSize) return null;
        return new long[] { start, Math.min(end, fileSize - 1) };
    }

    @Override
    public Response serve(IHTTPSession session) {
        Response response;
        try {
            response = handle(session);
        } catch (Exception e) {
            response = newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain",
                "Error del puente: " + e.getMessage());
        }
        // CORS completo: el fetch de capítulos manda el header Range y dispara preflight.
        response.addHeader("Access-Control-Allow-Origin", "*");
        response.addHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        response.addHeader("Access-Control-Allow-Headers", "Range");
        response.addHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");
        return response;
    }

    private Response handle(IHTTPSession session) throws IOException {
        if (session.getMethod() == Method.OPTIONS) {
            return newFixedLengthResponse(Response.Status.NO_CONTENT, "text/plain", "");
        }
        if (session.getMethod() != Method.GET && session.getMethod() != Method.HEAD) {
            return newFixedLengthResponse(Response.Status.METHOD_NOT_ALLOWED, "text/plain", "");
        }

        String uri = session.getUri();
        boolean local;
        if (uri.equals("/v/" + token)) local = false;
        else if (uri.equals("/lf/" + token)) local = true;
        else return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "No encontrado");

        Map<String, List<String>> params = session.getParameters();
        String path = firstParam(params, "path");
        if (path == null) return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "Falta path");

        long fileSize;
        String serverId = null;
        java.io.File localFile = null;

        if (local) {
            localFile = new java.io.File(path);
            if (!isAllowedLocal(localFile)) {
                return newFixedLengthResponse(Response.Status.FORBIDDEN, "text/plain", "Ruta no permitida");
            }
            if (!localFile.isFile()) {
                return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "No encontrado");
            }
            fileSize = localFile.length();
        } else {
            serverId = firstParam(params, "serverId");
            if (serverId == null) {
                return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "Falta serverId");
            }
            try {
                fileSize = manager.fileSize(serverId, path);
            } catch (IOException e) {
                return newFixedLengthResponse(Response.Status.BAD_GATEWAY, "text/plain", e.getMessage());
            }
        }

        String rangeHeader = session.getHeaders().get("range");
        long[] range = parseRange(rangeHeader, fileSize);

        if (rangeHeader != null && range == null) {
            Response invalid = newFixedLengthResponse(Response.Status.RANGE_NOT_SATISFIABLE, "text/plain", "");
            invalid.addHeader("Content-Range", "bytes */" + fileSize);
            invalid.addHeader("Accept-Ranges", "bytes");
            return invalid;
        }

        long start = range != null ? range[0] : 0;
        long end = range != null ? range[1] : Math.max(fileSize - 1, 0);
        long length = fileSize == 0 ? 0 : end - start + 1;

        InputStream stream;
        if (local) {
            FileInputStream fis = new FileInputStream(localFile);
            long skipped = 0;
            while (skipped < start) {
                long moved = fis.skip(start - skipped);
                if (moved <= 0) break;
                skipped += moved;
            }
            stream = new BoundedInputStream(fis, length);
        } else {
            stream = new SmbRangeInputStream(manager, serverId, path, start, length);
        }

        Response response = newFixedLengthResponse(
            range != null ? Response.Status.PARTIAL_CONTENT : Response.Status.OK,
            mimeForPath(path),
            stream,
            length);
        response.addHeader("Accept-Ranges", "bytes");
        // Sin caché a propósito: un item puede pasar del NAS a copia local a mitad de sesión.
        response.addHeader("Cache-Control", "no-store");
        if (range != null) {
            response.addHeader("Content-Range", "bytes " + start + "-" + end + "/" + fileSize);
        }
        return response;
    }

    private static String firstParam(Map<String, List<String>> params, String key) {
        List<String> values = params.get(key);
        return values == null || values.isEmpty() ? null : values.get(0);
    }

    private boolean isAllowedLocal(java.io.File file) {
        try {
            String canonical = file.getCanonicalPath();
            for (java.io.File root : localRoots) {
                if (canonical.startsWith(root.getCanonicalPath())) return true;
            }
        } catch (IOException ignored) {
        }
        return false;
    }

    /** Limita un InputStream a N bytes (para servir un rango de un archivo local). */
    private static class BoundedInputStream extends InputStream {
        private final InputStream inner;
        private long remaining;

        BoundedInputStream(InputStream inner, long limit) {
            this.inner = inner;
            this.remaining = limit;
        }

        @Override
        public int read() throws IOException {
            if (remaining <= 0) return -1;
            int value = inner.read();
            if (value >= 0) remaining--;
            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            if (remaining <= 0) return -1;
            int toRead = (int) Math.min(length, remaining);
            int read = inner.read(buffer, offset, toRead);
            if (read > 0) remaining -= read;
            return read;
        }

        @Override
        public void close() throws IOException {
            inner.close();
        }
    }

    /** Lee un rango de un archivo del NAS en bloques de 1 MiB sobre el handle cacheado. */
    private static class SmbRangeInputStream extends InputStream {
        private static final int CHUNK = 1024 * 1024;

        private final SmbClientManager manager;
        private final String serverId;
        private final String path;
        private final byte[] chunk = new byte[CHUNK];
        private long nextOffset;
        private long remaining;
        private int chunkPos;
        private int chunkLen;

        SmbRangeInputStream(SmbClientManager manager, String serverId, String path, long start, long length) {
            this.manager = manager;
            this.serverId = serverId;
            this.path = path;
            this.nextOffset = start;
            this.remaining = length;
        }

        private boolean fill() throws IOException {
            if (remaining <= 0) return false;
            int toRead = (int) Math.min(CHUNK, remaining);
            int read = manager.readAt(serverId, path, nextOffset, chunk, toRead);
            if (read <= 0) return false;
            nextOffset += read;
            remaining -= read;
            chunkPos = 0;
            chunkLen = read;
            return true;
        }

        @Override
        public int read() throws IOException {
            if (chunkPos >= chunkLen && !fill()) return -1;
            return chunk[chunkPos++] & 0xff;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            if (chunkPos >= chunkLen && !fill()) return -1;
            int available = chunkLen - chunkPos;
            int toCopy = Math.min(length, available);
            System.arraycopy(chunk, chunkPos, buffer, offset, toCopy);
            chunkPos += toCopy;
            return toCopy;
        }
    }
}
