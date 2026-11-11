package com.estrivisor.celular;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

// Serviço em primeiro plano enquanto a pessoa está numa chamada: mostra a notificação "Estrivisor — Você
// está numa chamada de voz" e mantém o microfone funcionando com a tela apagada. Tocar na notificação abre o app.
public class VozServico extends Service {
    private static final String CANAL = "estrivisor_chamada";
    private static final int ID = 4271;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String texto = intent != null && intent.getStringExtra("texto") != null ? intent.getStringExtra("texto") : "Você está numa chamada de voz";
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
            NotificationChannel canal = new NotificationChannel(CANAL, "Chamada de voz", NotificationManager.IMPORTANCE_LOW);
            canal.setDescription("Aparece enquanto você está numa chamada do Estrivisor");
            nm.createNotificationChannel(canal);
        }
        Intent abrir = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent toque = abrir == null ? null : PendingIntent.getActivity(this, 0, abrir, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, CANAL)
            .setContentTitle("Estrivisor")
            .setContentText(texto)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setOngoing(true)
            .setContentIntent(toque)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .build();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            else startForeground(ID, n);
        } catch (Exception e) {
            // Android recusou (ex.: microfone sem permissão): não derruba o app
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Fechou o app pela lista de recentes: a chamada acabou, some a notificação.
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
