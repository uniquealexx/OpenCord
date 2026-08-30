package org.opencord.mobile;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

/**
 * Оболочка WebView для OpenCord.
 *
 * Нативный слой отвечает за три вещи, которые web-часть не может узнать сама:
 *  1. системные отступы (статус-бар, панель навигации, вырез) — WebView рисуется
 *     edge-to-edge, а значения отдаются в CSS-переменные `--android-inset-*`
 *     (Android WebView не заполняет `env(safe-area-inset-*)` надёжно).
 *     Высота клавиатуры сюда намеренно не входит: её считает сам renderer по
 *     `visualViewport`, иначе при `adjustResize` смещение применялось бы дважды;
 *  2. системную кнопку «Назад» — она закрывает открытую панель или диалог и
 *     только на верхнем уровне сворачивает приложение.
 */
public class MainActivity extends BridgeActivity {

    /** Второе нажатие «Назад» в течение этого окна закрывает приложение. */
    private static final long EXIT_CONFIRM_WINDOW_MS = 2_000L;

    private long lastBackPressAt = 0L;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Рисуем под системными панелями: сама вёрстка отступает по --android-inset-*.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attributes = getWindow().getAttributes();
            attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(attributes);
        }

        // Интерфейс тёмный, поэтому иконки системных панелей — светлые.
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);

        final WebView webView = getBridge().getWebView();
        webView.setBackgroundColor(Color.parseColor("#191b1e"));

        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            float density = getResources().getDisplayMetrics().density;
            publishInsets(
                Math.round(bars.top / density),
                Math.round(bars.bottom / density),
                Math.round(bars.left / density),
                Math.round(bars.right / density));
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(webView);

        registerBackHandling();
    }

    private void publishInsets(int top, int bottom, int left, int right) {
        final String js =
            "window.__opencordNative && window.__opencordNative.setInsets("
                + top + "," + bottom + "," + left + "," + right + ")";
        runOnUiThread(() -> {
            if (getBridge() != null) getBridge().eval(js, value -> { });
        });
    }

    /**
     * Renderer сам решает, есть ли что закрывать: `window.__opencordNative.back()`
     * возвращает `true`, если событие обработано (закрыта панель, диалог, оверлей).
     * Иначе применяется поведение по умолчанию, но с подтверждением выхода —
     * случайное касание не должно выбрасывать пользователя из разговора.
     *
     * Используется OnBackPressedDispatcher, а не устаревший onBackPressed(): для
     * приложений с targetSdk 36 включён predictive back, и старый метод не вызывается.
     */
    private void registerBackHandling() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (getBridge() == null) {
                    finish();
                    return;
                }
                getBridge().eval(
                    "window.__opencordNative && window.__opencordNative.back() ? \"handled\" : \"\"",
                    value -> {
                        if (value != null && value.contains("handled")) return;
                        long now = System.currentTimeMillis();
                        if (now - lastBackPressAt < EXIT_CONFIRM_WINDOW_MS) {
                            lastBackPressAt = 0L;
                            moveTaskToBack(true);
                            return;
                        }
                        lastBackPressAt = now;
                        getBridge().eval("window.__opencordNative && window.__opencordNative.exitHint()", ignored -> { });
                    });
            }
        });
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            View decor = getWindow().getDecorView();
            ViewCompat.requestApplyInsets(decor);
        }
    }
}
