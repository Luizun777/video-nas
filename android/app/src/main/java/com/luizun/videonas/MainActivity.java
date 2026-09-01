package com.luizun.videonas;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Antes de super.onCreate, como pide Capacitor para plugins propios.
        registerPlugin(NasPlugin.class);
        registerPlugin(VlcPlayerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
