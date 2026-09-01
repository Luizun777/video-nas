package com.luizun.videonas;

import com.hierynomus.msdtyp.AccessMask;
import com.hierynomus.mserref.NtStatus;
import com.hierynomus.msfscc.FileAttributes;
import com.hierynomus.msfscc.fileinformation.FileAllInformation;
import com.hierynomus.msfscc.fileinformation.FileIdBothDirectoryInformation;
import com.hierynomus.mssmb2.SMB2CreateDisposition;
import com.hierynomus.mssmb2.SMB2ShareAccess;
import com.hierynomus.mssmb2.SMBApiException;
import com.hierynomus.protocol.commons.EnumWithValue;
import com.hierynomus.security.bc.BCSecurityProvider;
import com.hierynomus.smbj.SMBClient;
import com.hierynomus.smbj.SmbConfig;
import com.hierynomus.smbj.auth.AuthenticationContext;
import com.hierynomus.smbj.connection.Connection;
import com.hierynomus.smbj.session.Session;
import com.hierynomus.smbj.share.DiskShare;
import com.hierynomus.smbj.share.File;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * Conexiones SMB por servidor + caché de handles de archivo abiertos. Equivalente
 * Android del mount-manager de macOS: aquí no hay puntos de montaje, solo sesiones
 * SMBJ con las credenciales que el usuario guardó en Ajustes.
 */
public class SmbClientManager {

    public static class ServerEntry {
        public final String id;
        public final String host;
        public final String share;
        public final String username;
        public final String password;
        public final String domain;

        public ServerEntry(String id, String host, String share, String username, String password, String domain) {
            this.id = id;
            this.host = host;
            this.share = share;
            this.username = username == null ? "" : username;
            this.password = password == null ? "" : password;
            this.domain = domain == null ? "" : domain;
        }

        boolean sameAs(ServerEntry other) {
            return other != null
                && host.equals(other.host)
                && share.equals(other.share)
                && username.equals(other.username)
                && password.equals(other.password)
                && domain.equals(other.domain);
        }
    }

    public static class DirEntry {
        public final String name;
        public final boolean dir;
        public final long size;

        DirEntry(String name, boolean dir, long size) {
            this.name = name;
            this.dir = dir;
            this.size = size;
        }
    }

    public static class StatResult {
        public final boolean exists;
        public final boolean dir;
        public final long size;

        StatResult(boolean exists, boolean dir, long size) {
            this.exists = exists;
            this.dir = dir;
            this.size = size;
        }
    }

    public static class ProbeResult {
        public final String state; // online | offline | auth
        public final String message;

        ProbeResult(String state, String message) {
            this.state = state;
            this.message = message;
        }
    }

    /** Handle de share con caché LRU de archivos abiertos (los seeks reusan el handle). */
    private static class ShareHandle {
        final Object lock = new Object();
        Connection connection;
        Session session;
        DiskShare share;
        final Map<String, OpenFile> files = new HashMap<>();
    }

    private static class OpenFile {
        File file;
        long size;
        long lastUsed;
    }

    private static final int PORT_CHECK_TIMEOUT_MS = 1500;
    private static final int MAX_OPEN_FILES = 4;

    private final SMBClient client;
    private final Map<String, ServerEntry> servers = new ConcurrentHashMap<>();
    private final Map<String, ShareHandle> handles = new ConcurrentHashMap<>();

    public SmbClientManager() {
        SmbConfig config = SmbConfig.builder()
            .withSecurityProvider(new BCSecurityProvider())
            .withTimeout(20, TimeUnit.SECONDS)
            .withSoTimeout(30, TimeUnit.SECONDS)
            .build();
        client = new SMBClient(config);
    }

    public synchronized void configure(List<ServerEntry> entries) {
        for (ServerEntry entry : entries) {
            ServerEntry previous = servers.get(entry.id);
            if (!entry.sameAs(previous)) closeHandle(entry.id);
            servers.put(entry.id, entry);
        }
        for (String id : new ArrayList<>(servers.keySet())) {
            boolean stillThere = false;
            for (ServerEntry entry : entries) {
                if (entry.id.equals(id)) {
                    stillThere = true;
                    break;
                }
            }
            if (!stillThere) {
                closeHandle(id);
                servers.remove(id);
            }
        }
    }

    public ProbeResult probe(String serverId) {
        ServerEntry entry = servers.get(serverId);
        if (entry == null) return new ProbeResult("offline", "Servidor no configurado.");

        if (!isReachable(entry.host)) {
            return new ProbeResult("offline",
                "No se pudo contactar a " + entry.host + " en el puerto SMB (445).");
        }

        try {
            handleFor(serverId);
            return new ProbeResult("online", null);
        } catch (SMBApiException e) {
            if (isAuthFailure(e)) {
                return new ProbeResult("auth", "Usuario o contraseña SMB incorrectos. Revísalos en Ajustes.");
            }
            return new ProbeResult("offline", "SMB: " + e.getMessage());
        } catch (Exception e) {
            String message = e.getMessage();
            if (message != null && (message.contains("STATUS_LOGON_FAILURE") || message.contains("STATUS_ACCESS_DENIED"))) {
                return new ProbeResult("auth", "Usuario o contraseña SMB incorrectos. Revísalos en Ajustes.");
            }
            return new ProbeResult("offline", "No se pudo abrir el share: " + message);
        }
    }

    private static boolean isAuthFailure(SMBApiException e) {
        NtStatus status = e.getStatus();
        return status == NtStatus.STATUS_LOGON_FAILURE
            || status == NtStatus.STATUS_ACCESS_DENIED
            || status == NtStatus.STATUS_ACCOUNT_DISABLED;
    }

    private boolean isReachable(String host) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, 445), PORT_CHECK_TIMEOUT_MS);
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    static String toSmbPath(String relPath) {
        String cleaned = relPath.startsWith("/") ? relPath.substring(1) : relPath;
        return cleaned.replace('/', '\\');
    }

    private ShareHandle handleFor(String serverId) throws IOException {
        ShareHandle handle = handles.get(serverId);
        if (handle != null && handle.connection != null && handle.connection.isConnected()) {
            return handle;
        }
        synchronized (this) {
            handle = handles.get(serverId);
            if (handle != null && handle.connection != null && handle.connection.isConnected()) {
                return handle;
            }
            closeHandle(serverId);
            ServerEntry entry = servers.get(serverId);
            if (entry == null) throw new IOException("Servidor no configurado: " + serverId);

            ShareHandle fresh = new ShareHandle();
            fresh.connection = client.connect(entry.host);
            AuthenticationContext auth = entry.username.isEmpty()
                ? AuthenticationContext.guest()
                : new AuthenticationContext(
                    entry.username,
                    entry.password.toCharArray(),
                    entry.domain.isEmpty() ? null : entry.domain);
            fresh.session = fresh.connection.authenticate(auth);
            fresh.share = (DiskShare) fresh.session.connectShare(entry.share);
            handles.put(serverId, fresh);
            return fresh;
        }
    }

    private void closeHandle(String serverId) {
        ShareHandle handle = handles.remove(serverId);
        if (handle == null) return;
        synchronized (handle.lock) {
            for (OpenFile open : handle.files.values()) {
                try { open.file.close(); } catch (Exception ignored) { }
            }
            handle.files.clear();
            try { if (handle.share != null) handle.share.close(); } catch (Exception ignored) { }
            try { if (handle.session != null) handle.session.close(); } catch (Exception ignored) { }
            try { if (handle.connection != null) handle.connection.close(); } catch (Exception ignored) { }
        }
    }

    public synchronized void closeAll() {
        for (String id : new ArrayList<>(handles.keySet())) closeHandle(id);
    }

    public List<DirEntry> listDir(String serverId, String relPath) throws IOException {
        try {
            return doListDir(serverId, relPath);
        } catch (SMBApiException e) {
            throw new IOException("SMB: " + e.getMessage(), e);
        } catch (RuntimeException e) {
            // Transporte caído a media sesión: se reconecta una vez y se reintenta.
            closeHandle(serverId);
            try {
                return doListDir(serverId, relPath);
            } catch (RuntimeException retry) {
                throw new IOException("SMB: " + retry.getMessage(), retry);
            }
        }
    }

    private List<DirEntry> doListDir(String serverId, String relPath) throws IOException {
        ShareHandle handle = handleFor(serverId);
        synchronized (handle.lock) {
            List<DirEntry> entries = new ArrayList<>();
            for (FileIdBothDirectoryInformation info : handle.share.list(toSmbPath(relPath))) {
                String name = info.getFileName();
                if (".".equals(name) || "..".equals(name)) continue;
                boolean dir = EnumWithValue.EnumUtils.isSet(
                    info.getFileAttributes(), FileAttributes.FILE_ATTRIBUTE_DIRECTORY);
                entries.add(new DirEntry(name, dir, dir ? 0 : info.getEndOfFile()));
            }
            return entries;
        }
    }

    public StatResult statFile(String serverId, String relPath) throws IOException {
        ShareHandle handle = handleFor(serverId);
        synchronized (handle.lock) {
            String smbPath = toSmbPath(relPath);
            try {
                if (handle.share.folderExists(smbPath)) return new StatResult(true, true, 0);
                if (!handle.share.fileExists(smbPath)) return new StatResult(false, false, 0);
                FileAllInformation info = handle.share.getFileInformation(smbPath);
                return new StatResult(true, false, info.getStandardInformation().getEndOfFile());
            } catch (SMBApiException e) {
                if (e.getStatus() == NtStatus.STATUS_OBJECT_NAME_NOT_FOUND
                    || e.getStatus() == NtStatus.STATUS_OBJECT_PATH_NOT_FOUND) {
                    return new StatResult(false, false, 0);
                }
                throw new IOException("SMB: " + e.getMessage(), e);
            }
        }
    }

    public long fileSize(String serverId, String relPath) throws IOException {
        StatResult stat = statFile(serverId, relPath);
        if (!stat.exists || stat.dir) throw new IOException("El archivo ya no existe en el NAS: " + relPath);
        return stat.size;
    }

    /**
     * Contenido completo de un archivo PEQUEÑO (metadata compartida), o null si no
     * existe. Handle efímero a propósito: no entra a la caché LRU de streaming.
     */
    public byte[] readFileFully(String serverId, String relPath) throws IOException {
        ShareHandle handle = handleFor(serverId);
        synchronized (handle.lock) {
            String smbPath = toSmbPath(relPath);
            try {
                if (!handle.share.fileExists(smbPath)) return null;
                try (File file = handle.share.openFile(
                        smbPath,
                        EnumSet.of(AccessMask.GENERIC_READ),
                        null,
                        SMB2ShareAccess.ALL,
                        SMB2CreateDisposition.FILE_OPEN,
                        null);
                     java.io.InputStream in = file.getInputStream()) {
                    java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
                    return out.toByteArray();
                }
            } catch (SMBApiException e) {
                if (e.getStatus() == NtStatus.STATUS_OBJECT_NAME_NOT_FOUND
                    || e.getStatus() == NtStatus.STATUS_OBJECT_PATH_NOT_FOUND) {
                    return null;
                }
                throw new IOException("SMB: " + e.getMessage(), e);
            }
        }
    }

    /**
     * Escritura atómica en el share: crea las carpetas padre, escribe a un .tmp con
     * GENERIC_WRITE y renombra encima del destino. Handle efímero, fuera de la LRU.
     */
    public void writeFileAtomic(String serverId, String relPath, byte[] data) throws IOException {
        ShareHandle handle = handleFor(serverId);
        synchronized (handle.lock) {
            try {
                String cleaned = relPath.startsWith("/") ? relPath.substring(1) : relPath;
                int slash = cleaned.lastIndexOf('/');
                if (slash > 0) {
                    StringBuilder dir = new StringBuilder();
                    for (String part : cleaned.substring(0, slash).split("/")) {
                        if (dir.length() > 0) dir.append('\\');
                        dir.append(part);
                        String smbDir = dir.toString();
                        if (!handle.share.folderExists(smbDir)) handle.share.mkdir(smbDir);
                    }
                }
                String smbPath = toSmbPath(cleaned);
                try (File file = handle.share.openFile(
                        smbPath + ".tmp",
                        EnumSet.of(AccessMask.GENERIC_WRITE, AccessMask.DELETE),
                        null,
                        SMB2ShareAccess.ALL,
                        SMB2CreateDisposition.FILE_OVERWRITE_IF,
                        null)) {
                    file.write(data, 0);
                    file.rename(smbPath, true);
                }
            } catch (SMBApiException e) {
                throw new IOException("SMB: " + e.getMessage(), e);
            }
        }
    }

    /**
     * Lee hasta buffer.length bytes en fileOffset. Devuelve los bytes leídos o -1 en EOF.
     * Reintenta UNA vez reconectando si el transporte murió a mitad de stream.
     */
    public int readAt(String serverId, String relPath, long fileOffset, byte[] buffer, int length) throws IOException {
        try {
            return doReadAt(serverId, relPath, fileOffset, buffer, length);
        } catch (SMBApiException e) {
            throw new IOException("SMB: " + e.getMessage(), e);
        } catch (RuntimeException e) {
            closeHandle(serverId);
            try {
                return doReadAt(serverId, relPath, fileOffset, buffer, length);
            } catch (RuntimeException retry) {
                throw new IOException("SMB: " + retry.getMessage(), retry);
            }
        }
    }

    private int doReadAt(String serverId, String relPath, long fileOffset, byte[] buffer, int length) throws IOException {
        ShareHandle handle = handleFor(serverId);
        synchronized (handle.lock) {
            OpenFile open = handle.files.get(relPath);
            if (open == null) {
                // LRU sencillo: al llegar al tope se cierra el menos usado.
                if (handle.files.size() >= MAX_OPEN_FILES) {
                    String oldestKey = null;
                    long oldest = Long.MAX_VALUE;
                    for (Map.Entry<String, OpenFile> candidate : handle.files.entrySet()) {
                        if (candidate.getValue().lastUsed < oldest) {
                            oldest = candidate.getValue().lastUsed;
                            oldestKey = candidate.getKey();
                        }
                    }
                    if (oldestKey != null) {
                        try { handle.files.remove(oldestKey).file.close(); } catch (Exception ignored) { }
                    }
                }
                open = new OpenFile();
                open.file = handle.share.openFile(
                    toSmbPath(relPath),
                    EnumSet.of(AccessMask.GENERIC_READ),
                    null,
                    SMB2ShareAccess.ALL,
                    SMB2CreateDisposition.FILE_OPEN,
                    null);
                open.size = open.file.getFileInformation().getStandardInformation().getEndOfFile();
                handle.files.put(relPath, open);
            }
            open.lastUsed = System.currentTimeMillis();
            if (fileOffset >= open.size) return -1;
            int toRead = (int) Math.min(length, open.size - fileOffset);
            return open.file.read(buffer, fileOffset, 0, toRead);
        }
    }
}
