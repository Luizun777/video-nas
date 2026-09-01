package com.luizun.videonas;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.view.ViewGroup;
import android.webkit.WebView;

import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.util.VLCVideoLayout;

import java.util.ArrayList;
import java.util.List;

/**
 * Dueño del MediaPlayer de libVLC y de su superficie de video. La superficie es un
 * VLCVideoLayout (con TextureView forzado: el hole-punching de SurfaceView falla en
 * varios OEM al redimensionar) insertado DEBAJO del WebView de Capacitor; el WebView
 * se vuelve transparente mientras el player nativo está abierto y la UI web (los
 * controles de React) se dibuja encima.
 *
 * Todos los métodos públicos pueden llamarse desde cualquier hilo: lo que toca vistas
 * se re-despacha al hilo de UI.
 */
public class VlcPlayerManager {

    /** Eventos hacia el plugin (que los reenvía al WebView como "vlcEvent"). */
    public interface Listener {
        void onVlcEvent(String kind, long timeMs, long durationMs, String message);
    }

    private static final long TIME_EVENT_THROTTLE_MS = 250;

    private final Activity activity;
    private final WebView webView;
    private final Listener listener;

    private LibVLC libVlc;
    private MediaPlayer player;
    private VLCVideoLayout videoLayout;
    private boolean viewsAttached = false;
    private long lastTimeEventAt = 0;
    private boolean lastBufferingStalled = false;

    public VlcPlayerManager(Activity activity, WebView webView, Listener listener) {
        this.activity = activity;
        this.webView = webView;
        this.listener = listener;
    }

    public void open(String url, long startAtMs) {
        activity.runOnUiThread(() -> {
            releaseOnUiThread();

            List<String> options = new ArrayList<>();
            // El puente local puede cortar la conexión al hacer seek: reconectar solo.
            options.add("--http-reconnect");
            options.add("--network-caching=1500");
            libVlc = new LibVLC(activity.getApplicationContext(), options);
            player = new MediaPlayer(libVlc);
            player.setEventListener(this::handlePlayerEvent);

            videoLayout = new VLCVideoLayout(activity);
            ViewGroup parent = (ViewGroup) webView.getParent();
            if (parent != null && videoLayout.getParent() == null) {
                parent.addView(videoLayout, 0,
                    new ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT));
            }
            webView.setBackgroundColor(Color.TRANSPARENT);
            attachViewsOnUiThread();

            Media media = new Media(libVlc, Uri.parse(url));
            if (startAtMs > 0) {
                media.addOption(":start-time=" + (startAtMs / 1000.0));
            }
            player.setMedia(media);
            media.release();
            player.play();
        });
    }

    public void play() {
        activity.runOnUiThread(() -> {
            if (player != null) player.play();
        });
    }

    public void pause() {
        activity.runOnUiThread(() -> {
            if (player != null) player.pause();
        });
    }

    public void seekTo(long timeMs) {
        activity.runOnUiThread(() -> {
            if (player != null) player.setTime(Math.max(0, timeMs));
        });
    }

    /** volume 0..100. */
    public void setVolume(int volume) {
        activity.runOnUiThread(() -> {
            if (player != null) player.setVolume(Math.max(0, Math.min(100, volume)));
        });
    }

    public boolean isPlaying() {
        return player != null && player.isPlaying();
    }

    public long getTimeMs() {
        return player != null ? Math.max(0, player.getTime()) : 0;
    }

    public long getLengthMs() {
        return player != null ? Math.max(0, player.getLength()) : 0;
    }

    /** id -1 es la entrada "Disable" de libVLC: se filtra (la UI usa null para apagar). */
    public MediaPlayer.TrackDescription[] getAudioTracks() {
        return player != null ? player.getAudioTracks() : null;
    }

    public MediaPlayer.TrackDescription[] getSpuTracks() {
        return player != null ? player.getSpuTracks() : null;
    }

    public int getSelectedAudioTrack() {
        return player != null ? player.getAudioTrack() : -1;
    }

    public int getSelectedSpuTrack() {
        return player != null ? player.getSpuTrack() : -1;
    }

    public void setAudioTrack(int id) {
        activity.runOnUiThread(() -> {
            if (player != null) player.setAudioTrack(id);
        });
    }

    /** -1 apaga los subtítulos. */
    public void setSpuTrack(int id) {
        activity.runOnUiThread(() -> {
            if (player != null) player.setSpuTrack(id);
        });
    }

    public void addSubtitleSlave(String url, boolean select) {
        activity.runOnUiThread(() -> {
            if (player != null) player.addSlave(Media.Slave.Type.Subtitle, Uri.parse(url), select);
        });
    }

    /** 'fullscreen' = superficie visible a pantalla; 'hidden' = solo audio (mini-barra). */
    public void setLayoutMode(String mode) {
        activity.runOnUiThread(() -> {
            if (videoLayout == null || player == null) return;
            if ("hidden".equals(mode)) {
                if (viewsAttached) {
                    player.detachViews();
                    viewsAttached = false;
                }
                videoLayout.setVisibility(android.view.View.GONE);
            } else {
                videoLayout.setVisibility(android.view.View.VISIBLE);
                attachViewsOnUiThread();
            }
        });
    }

    public void close() {
        activity.runOnUiThread(this::releaseOnUiThread);
    }

    private void attachViewsOnUiThread() {
        if (player != null && videoLayout != null && !viewsAttached) {
            // true, true = subtítulos nativos + TextureView forzado.
            player.attachViews(videoLayout, null, true, true);
            viewsAttached = true;
        }
    }

    private void releaseOnUiThread() {
        if (player != null) {
            player.setEventListener(null);
            player.stop();
            if (viewsAttached) player.detachViews();
            player.release();
            player = null;
        }
        viewsAttached = false;
        if (videoLayout != null) {
            ViewGroup parent = (ViewGroup) videoLayout.getParent();
            if (parent != null) parent.removeView(videoLayout);
            videoLayout = null;
        }
        if (libVlc != null) {
            libVlc.release();
            libVlc = null;
        }
        // El WebView vuelve a ser opaco: la app pinta su propio fondo oscuro.
        webView.setBackgroundColor(Color.BLACK);
        lastBufferingStalled = false;
    }

    private void handlePlayerEvent(MediaPlayer.Event event) {
        switch (event.type) {
            case MediaPlayer.Event.Playing:
                listener.onVlcEvent("playing", getTimeMs(), getLengthMs(), null);
                break;
            case MediaPlayer.Event.Paused:
                listener.onVlcEvent("paused", getTimeMs(), getLengthMs(), null);
                break;
            case MediaPlayer.Event.TimeChanged: {
                long now = System.currentTimeMillis();
                if (now - lastTimeEventAt >= TIME_EVENT_THROTTLE_MS) {
                    lastTimeEventAt = now;
                    listener.onVlcEvent("time", event.getTimeChanged(), getLengthMs(), null);
                }
                break;
            }
            case MediaPlayer.Event.LengthChanged:
                listener.onVlcEvent("duration", getTimeMs(), event.getLengthChanged(), null);
                break;
            case MediaPlayer.Event.EndReached:
                listener.onVlcEvent("ended", getLengthMs(), getLengthMs(), null);
                break;
            case MediaPlayer.Event.EncounteredError:
                listener.onVlcEvent("error", getTimeMs(), getLengthMs(), "libVLC no pudo reproducir el stream.");
                break;
            case MediaPlayer.Event.Buffering: {
                // Solo transiciones (atascado <-> fluido): el evento crudo es muy ruidoso.
                boolean stalled = event.getBuffering() < 100f;
                if (stalled != lastBufferingStalled) {
                    lastBufferingStalled = stalled;
                    listener.onVlcEvent(stalled ? "buffering" : "playing", getTimeMs(), getLengthMs(), null);
                }
                break;
            }
            case MediaPlayer.Event.ESAdded:
            case MediaPlayer.Event.ESDeleted:
                listener.onVlcEvent("tracks", getTimeMs(), getLengthMs(), null);
                break;
            default:
                break;
        }
    }
}
