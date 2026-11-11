package com.estrivisor.celular;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

// Tela principal do app (Capacitor). Registra o plugin da chamada e deixa o áudio tocar sem precisar de toque.
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VozPlugin.class);
        super.onCreate(savedInstanceState);
        try {
            getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
        } catch (Exception e) {
            // segue sem: o som das pessoas toca depois do primeiro toque na tela
        }
    }
}
