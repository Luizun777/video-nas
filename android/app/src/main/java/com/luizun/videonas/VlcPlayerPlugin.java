package com.luizun.videonas;

import android.view.WindowManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.videolan.libvlc.MediaPlayer;

/**
 * Reproductor embebido universal (libVLC) para Android. El contrato JS vive en
 * src/mobile/vlc-player-plugin.ts — cualquier cambio aquí se refleja allá.
 * Mantiene FLAG_KEEP_SCREEN_ON mientras reproduce (y lo suelta al pausar/cerrar),
 * independiente del keepScreenOn del escaneo en NasPlugin.
 */
@CapacitorPlugin(name = "VlcPlayer")
public class VlcPlayerPlugin extends Plugin {

    private VlcPlayerManager manager;

    private VlcPlayerManager ensureManager() {
        if (manager == null) {
            manager = new VlcPlayerManager(getActivity(), bridge.getWebView(), this::emitVlcEvent);
        }
        return manager;
    }

    private void emitVlcEvent(String kind, long timeMs, long durationMs, String message) {
        if ("playing".equals(kind)) setKeepScreenOn(true);
        if ("paused".equals(kind) || "ended".equals(kind) || "error".equals(kind)) setKeepScreenOn(false);

        JSObject data = new JSObject();
        data.put("kind", kind);
        data.put("timeMs", timeMs);
        data.put("durationMs", durationMs);
        if (message != null) data.put("message", message);
        notifyListeners("vlcEvent", data);
    }

    private void setKeepScreenOn(boolean on) {
        if (getActivity() == null) return;
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (manager != null) manager.close();
    }

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Falta la URL del stream.");
            return;
        }
        // getDouble y no getLong: los números de JS llegan como Double y getLong puede
        // caer al valor por defecto — con 0 el reproductor "salta" al principio.
        double startAtMs = call.getDouble("startAtMs", 0.0);
        ensureManager().open(url, (long) startAtMs);
        call.resolve(new JSObject().put("ok", true));
    }

    @PluginMethod
    public void play(PluginCall call) {
        ensureManager().play();
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        ensureManager().pause();
        call.resolve();
    }

    @PluginMethod
    public void seek(PluginCall call) {
        double timeMs = call.getDouble("timeMs", 0.0);
        android.util.Log.i("VlcPlayer", "seek -> " + (long) timeMs + " ms");
        ensureManager().seekTo((long) timeMs);
        call.resolve();
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        ensureManager().setVolume(call.getInt("volume", 100));
        call.resolve();
    }

    @PluginMethod
    public void getTracks(PluginCall call) {
        VlcPlayerManager m = ensureManager();
        JSObject result = new JSObject();
        result.put("audio", describeTracks(m.getAudioTracks()));
        result.put("subtitles", describeTracks(m.getSpuTracks()));
        result.put("selectedAudio", m.getSelectedAudioTrack());
        result.put("selectedSubtitle", m.getSelectedSpuTrack());
        call.resolve(result);
    }

    private JSArray describeTracks(MediaPlayer.TrackDescription[] tracks) {
        JSArray list = new JSArray();
        if (tracks == null) return list;
        for (MediaPlayer.TrackDescription track : tracks) {
            if (track.id < 0) continue; // la entrada "Disable" de libVLC; la UI usa null.
            JSObject item = new JSObject();
            item.put("id", track.id);
            item.put("name", track.name);
            list.put(item);
        }
        return list;
    }

    @PluginMethod
    public void setAudioTrack(PluginCall call) {
        Integer id = call.getInt("id");
        if (id == null) {
            call.reject("Falta el id de la pista.");
            return;
        }
        ensureManager().setAudioTrack(id);
        call.resolve();
    }

    @PluginMethod
    public void setSubtitleTrack(PluginCall call) {
        // null = apagar subtítulos (spu -1).
        Integer id = call.getInt("id");
        ensureManager().setSpuTrack(id == null ? -1 : id);
        call.resolve();
    }

    @PluginMethod
    public void addSubtitleSlave(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Falta la URL del subtítulo.");
            return;
        }
        Boolean select = call.getBoolean("select", true);
        ensureManager().addSubtitleSlave(url, Boolean.TRUE.equals(select));
        call.resolve();
    }

    @PluginMethod
    public void setVideoLayout(PluginCall call) {
        String mode = call.getString("mode", "fullscreen");
        ensureManager().setLayoutMode(mode);
        call.resolve();
    }

    @PluginMethod
    public void close(PluginCall call) {
        if (manager != null) manager.close();
        setKeepScreenOn(false);
        call.resolve();
    }
}
