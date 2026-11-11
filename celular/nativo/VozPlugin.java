package com.estrivisor.celular;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Chamado pelo app quando entra/sai de uma chamada de voz.
// iniciar: liga o aviso "Na chamada" (serviço em primeiro plano do tipo microfone) — sem ele o Android
//          corta o microfone quando a tela apaga ou a pessoa troca de app — e põe o som no alto-falante
//          (se não tiver fone), porque chamadas no Android saem pelo fone de ouvido do aparelho por padrão.
// parar:   desliga tudo e volta o áudio ao normal.
@CapacitorPlugin(name = "VozCelular")
public class VozPlugin extends Plugin {

    @PluginMethod
    public void iniciar(PluginCall call) {
        Context ctx = getContext();
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            call.reject("sem-permissao-microfone");
            return;
        }
        try {
            Intent i = new Intent(ctx, VozServico.class);
            i.putExtra("texto", call.getString("texto", "Você está numa chamada de voz"));
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i);
            else ctx.startService(i);
            ajustarSaida(ctx, true);
            call.resolve();
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }

    @PluginMethod
    public void parar(PluginCall call) {
        Context ctx = getContext();
        try { ctx.stopService(new Intent(ctx, VozServico.class)); } catch (Exception e) { /* já estava parado */ }
        ajustarSaida(ctx, false);
        call.resolve();
    }

    @SuppressWarnings("deprecation")
    private void ajustarSaida(Context ctx, boolean naChamada) {
        try {
            AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return;
            if (naChamada) {
                boolean temFone = am.isWiredHeadsetOn() || am.isBluetoothA2dpOn() || am.isBluetoothScoOn();
                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                am.setSpeakerphoneOn(!temFone);
            } else {
                am.setSpeakerphoneOn(false);
                am.setMode(AudioManager.MODE_NORMAL);
            }
        } catch (Exception e) {
            // sem acesso ao áudio: fica como o sistema decidir
        }
    }
}
