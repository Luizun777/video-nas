package com.luizun.videonas;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Environment;
import android.os.StatFs;
import android.view.WindowManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.FileOutputStream;
import java.io.IOException;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

import fi.iki.elonen.NanoHTTPD;

/**
 * Lado nativo del port Android: cliente SMB (SmbClientManager), puente HTTP de streaming
 * (StreamServer) y utilidades de plataforma (Intents de video, keep-screen-on, archivos
 * locales de descargas). El contrato JS vive en src/mobile/nas-plugin.ts.
 */
@CapacitorPlugin(name = "Nas")
public class NasPlugin extends Plugin {

    /** Debe coincidir con DOWNLOAD_CANCELLED de core (download-manager.ts). */
    private static final String CANCELLED = "CANCELLED";
    private static final int DOWNLOAD_CHUNK = 1024 * 1024;
    private static final long PROGRESS_THROTTLE_MS = 500;

    private final SmbClientManager manager = new SmbClientManager();
    private final ExecutorService ioPool = Executors.newFixedThreadPool(3);
    private final ExecutorService downloadPool = Executors.newSingleThreadExecutor();
    private final Map<String, AtomicBoolean> downloadCancels = new ConcurrentHashMap<>();

    private StreamServer server;
    private String bridgeToken;

    @Override
    public void load() {
        byte[] tokenBytes = new byte[16];
        new SecureRandom().nextBytes(tokenBytes);
        StringBuilder hex = new StringBuilder();
        for (byte b : tokenBytes) hex.append(String.format("%02x", b));
        bridgeToken = hex.toString();

        List<java.io.File> roots = new ArrayList<>();
        java.io.File external = getContext().getExternalFilesDir(null);
        if (external != null) roots.add(external);
        roots.add(getContext().getFilesDir());

        server = new StreamServer(manager, bridgeToken, roots);
        try {
            server.start(NanoHTTPD.SOCKET_READ_TIMEOUT, true);
        } catch (IOException e) {
            server = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (server != null) server.stop();
        manager.closeAll();
        ioPool.shutdownNow();
        downloadPool.shutdownNow();
    }

    // ------------------------------------------------------------------ SMB --

    @PluginMethod
    public void configure(PluginCall call) {
        JSArray serversJson = call.getArray("servers");
        if (serversJson == null) {
            call.reject("Falta servers");
            return;
        }
        List<SmbClientManager.ServerEntry> entries = new ArrayList<>();
        try {
            for (int i = 0; i < serversJson.length(); i++) {
                JSONObject item = serversJson.getJSONObject(i);
                entries.add(new SmbClientManager.ServerEntry(
                    item.getString("id"),
                    item.getString("host"),
                    item.getString("share"),
                    item.optString("username", ""),
                    item.optString("password", ""),
                    item.optString("domain", "")));
            }
        } catch (JSONException e) {
            call.reject("servers inválido: " + e.getMessage());
            return;
        }
        manager.configure(entries);
        call.resolve(new JSObject().put("ok", true));
    }

    @PluginMethod
    public void probe(PluginCall call) {
        String serverId = call.getString("serverId");
        if (serverId == null) {
            call.reject("Falta serverId");
            return;
        }
        ioPool.execute(() -> {
            SmbClientManager.ProbeResult result = manager.probe(serverId);
            JSObject ret = new JSObject().put("state", result.state);
            if (result.message != null) ret.put("message", result.message);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void listDir(PluginCall call) {
        String serverId = call.getString("serverId");
        String path = call.getString("path");
        if (serverId == null || path == null) {
            call.reject("Faltan serverId/path");
            return;
        }
        ioPool.execute(() -> {
            try {
                List<SmbClientManager.DirEntry> entries = manager.listDir(serverId, path);
                JSArray array = new JSArray();
                for (SmbClientManager.DirEntry entry : entries) {
                    array.put(new JSObject()
                        .put("name", entry.name)
                        .put("dir", entry.dir)
                        .put("size", entry.size));
                }
                call.resolve(new JSObject().put("entries", array));
            } catch (IOException e) {
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void statFile(PluginCall call) {
        String serverId = call.getString("serverId");
        String path = call.getString("path");
        if (serverId == null || path == null) {
            call.reject("Faltan serverId/path");
            return;
        }
        ioPool.execute(() -> {
            try {
                SmbClientManager.StatResult stat = manager.statFile(serverId, path);
                call.resolve(new JSObject()
                    .put("exists", stat.exists)
                    .put("dir", stat.dir)
                    .put("size", stat.size));
            } catch (IOException e) {
                call.reject(e.getMessage());
            }
        });
    }

    // --------------------------------------------------------------- puente --

    @PluginMethod
    public void getBridgeInfo(PluginCall call) {
        if (server == null) {
            call.reject("El puente de streaming no pudo arrancar.");
            return;
        }
        call.resolve(new JSObject()
            .put("port", server.getListeningPort())
            .put("token", bridgeToken));
    }

    // ------------------------------------------------------------- descargas --

    @PluginMethod
    public void download(PluginCall call) {
        String key = call.getString("key");
        String serverId = call.getString("serverId");
        String path = call.getString("path");
        String localPath = call.getString("localPath");
        if (key == null || serverId == null || path == null || localPath == null) {
            call.reject("Faltan key/serverId/path/localPath");
            return;
        }

        AtomicBoolean cancelled = new AtomicBoolean(false);
        downloadCancels.put(key, cancelled);
        call.resolve(new JSObject().put("started", true));

        downloadPool.execute(() -> {
            java.io.File target = new java.io.File(localPath);
            java.io.File parent = target.getParentFile();
            if (parent != null) parent.mkdirs();

            long total;
            try {
                total = manager.fileSize(serverId, path);
            } catch (IOException e) {
                emitDownload(key, 0, 0, "error", e.getMessage());
                downloadCancels.remove(key);
                return;
            }

            byte[] buffer = new byte[DOWNLOAD_CHUNK];
            long done = 0;
            long lastEmit = 0;

            try (FileOutputStream out = new FileOutputStream(target)) {
                while (done < total) {
                    if (cancelled.get()) {
                        out.close();
                        target.delete();
                        emitDownload(key, done, total, "error", CANCELLED);
                        return;
                    }
                    int read = manager.readAt(serverId, path, done,
                        buffer, (int) Math.min(buffer.length, total - done));
                    if (read <= 0) break;
                    out.write(buffer, 0, read);
                    done += read;
                    long now = System.currentTimeMillis();
                    if (now - lastEmit >= PROGRESS_THROTTLE_MS || done >= total) {
                        lastEmit = now;
                        emitDownload(key, done, total, "downloading", null);
                    }
                }
            } catch (IOException e) {
                target.delete();
                emitDownload(key, done, total, "error", "Error al copiar el archivo: " + e.getMessage());
                downloadCancels.remove(key);
                return;
            }

            if (done >= total) emitDownload(key, done, total, "done", null);
            else emitDownload(key, done, total, "error", "La copia terminó incompleta.");
            downloadCancels.remove(key);
        });
    }

    private void emitDownload(String key, long bytesDone, long totalBytes, String state, String error) {
        JSObject data = new JSObject()
            .put("key", key)
            .put("bytesDone", bytesDone)
            .put("totalBytes", totalBytes)
            .put("state", state);
        if (error != null) data.put("error", error);
        notifyListeners("downloadProgress", data);
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        String key = call.getString("key");
        if (key != null) {
            AtomicBoolean flag = downloadCancels.get(key);
            if (flag != null) flag.set(true);
        }
        call.resolve(new JSObject().put("ok", true));
    }

    // ------------------------------------------------------- archivos locales --

    private boolean isAllowedLocal(java.io.File file) {
        try {
            String canonical = file.getCanonicalPath();
            java.io.File external = getContext().getExternalFilesDir(null);
            if (external != null && canonical.startsWith(external.getCanonicalPath())) return true;
            return canonical.startsWith(getContext().getFilesDir().getCanonicalPath());
        } catch (IOException e) {
            return false;
        }
    }

    @PluginMethod
    public void renameFile(PluginCall call) {
        String from = call.getString("from");
        String to = call.getString("to");
        if (from == null || to == null) {
            call.reject("Faltan from/to");
            return;
        }
        java.io.File source = new java.io.File(from);
        java.io.File target = new java.io.File(to);
        if (!isAllowedLocal(source) || !isAllowedLocal(target)) {
            call.reject("Ruta no permitida");
            return;
        }
        target.delete();
        if (source.renameTo(target)) call.resolve(new JSObject().put("ok", true));
        else call.reject("No se pudo renombrar " + from);
    }

    @PluginMethod
    public void deleteLocalFile(PluginCall call) {
        String path = call.getString("path");
        if (path == null) {
            call.reject("Falta path");
            return;
        }
        java.io.File file = new java.io.File(path);
        if (!isAllowedLocal(file)) {
            call.reject("Ruta no permitida");
            return;
        }
        file.delete();
        call.resolve(new JSObject().put("ok", true));
    }

    @PluginMethod
    public void ensureDir(PluginCall call) {
        String path = call.getString("path");
        if (path == null) {
            call.reject("Falta path");
            return;
        }
        java.io.File dir = new java.io.File(path);
        if (!isAllowedLocal(dir)) {
            call.reject("Ruta no permitida");
            return;
        }
        dir.mkdirs();
        call.resolve(new JSObject().put("ok", true));
    }

    @PluginMethod
    public void exists(PluginCall call) {
        String path = call.getString("path");
        call.resolve(new JSObject().put("exists", path != null && new java.io.File(path).exists()));
    }

    @PluginMethod
    public void freeSpace(PluginCall call) {
        java.io.File dir = getContext().getExternalFilesDir(null);
        if (dir == null) dir = getContext().getFilesDir();
        try {
            StatFs stat = new StatFs(dir.getAbsolutePath());
            call.resolve(new JSObject().put("bytes", stat.getAvailableBytes()));
        } catch (Exception e) {
            call.reject("No se pudo consultar el espacio libre.");
        }
    }

    @PluginMethod
    public void localVideosDir(PluginCall call) {
        java.io.File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_MOVIES);
        if (dir == null) dir = new java.io.File(getContext().getFilesDir(), "Movies");
        dir.mkdirs();
        call.resolve(new JSObject().put("path", dir.getAbsolutePath()));
    }

    // ----------------------------------------------------- reproductor externo --

    @PluginMethod
    public void listVideoApps(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(Uri.parse("http://127.0.0.1/video.mkv"), "video/*");
        PackageManager pm = getContext().getPackageManager();
        List<ResolveInfo> infos = pm.queryIntentActivities(intent, PackageManager.MATCH_ALL);

        JSArray apps = new JSArray();
        Set<String> seen = new HashSet<>();
        for (ResolveInfo info : infos) {
            String packageName = info.activityInfo.packageName;
            if (packageName.equals(getContext().getPackageName())) continue;
            if (!seen.add(packageName)) continue;
            apps.put(new JSObject()
                .put("packageName", packageName)
                .put("label", info.loadLabel(pm).toString()));
        }
        call.resolve(new JSObject().put("apps", apps));
    }

    @PluginMethod
    public void playExternal(PluginCall call) {
        String url = call.getString("url");
        String mime = call.getString("mime", "video/*");
        String title = call.getString("title");
        String packageName = call.getString("packageName");
        if (url == null) {
            call.reject("Falta url");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(Uri.parse(url), mime);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (title != null) intent.putExtra("title", title);
        if (packageName != null && !packageName.isEmpty()) intent.setPackage(packageName);

        try {
            getContext().startActivity(intent);
            call.resolve(new JSObject().put("ok", true));
        } catch (ActivityNotFoundException e) {
            if (packageName != null && !packageName.isEmpty()) {
                intent.setPackage(null);
                try {
                    getContext().startActivity(intent);
                    call.resolve(new JSObject().put("ok", true));
                    return;
                } catch (ActivityNotFoundException ignored) {
                }
            }
            call.resolve(new JSObject()
                .put("ok", false)
                .put("error", "No hay ninguna app de video instalada. Instala VLC para reproducir este formato."));
        }
    }

    // ------------------------------------------------------------- pantalla --

    @PluginMethod
    public void keepScreenOn(PluginCall call) {
        Boolean on = call.getBoolean("on", false);
        if (getActivity() == null) {
            call.resolve(new JSObject().put("ok", false));
            return;
        }
        boolean keep = Boolean.TRUE.equals(on);
        getActivity().runOnUiThread(() -> {
            if (keep) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
        call.resolve(new JSObject().put("ok", true));
    }
}
