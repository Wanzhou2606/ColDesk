package com.coldesk.mobile;

import android.content.Intent;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Collections;

/** Android launchers accept arbitrary user artwork through a pinned shortcut. */
@CapacitorPlugin(name = "ColDeskAppearance")
public class ColDeskAppearancePlugin extends Plugin {
    private static final String SHORTCUT_ID = "coldesk-personal-icon";
    @PluginMethod
    public void shortcut(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                ShortcutManager manager = getContext().getSystemService(ShortcutManager.class);
                boolean supported = manager != null && manager.isRequestPinShortcutSupported();
                boolean pinned = manager != null && manager.getPinnedShortcuts().stream().anyMatch(s -> SHORTCUT_ID.equals(s.getId()));
                boolean requested = false;
                if (manager != null && (pinned || Boolean.TRUE.equals(call.getBoolean("pin", false)) && supported)) {
                    String data = call.getString("data");
                    Icon icon = Icon.createWithResource(getContext(), R.mipmap.ic_launcher);
                    if (data != null && !data.isEmpty()) {
                        if (data.length() > 2800000) { call.reject("图标文件过大"); return; }
                        byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                        BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
                        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
                        if (bounds.outWidth < 1 || bounds.outHeight < 1 || bounds.outWidth > 1024 || bounds.outHeight > 1024) { call.reject("图标尺寸不正确"); return; }
                        Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                        if (bitmap == null) { call.reject("图片无法读取"); return; }
                        icon = Icon.createWithBitmap(bitmap);
                    }
                    Intent intent = new Intent(getContext(), MainActivity.class).setAction(Intent.ACTION_VIEW)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    ShortcutInfo info = new ShortcutInfo.Builder(getContext(), SHORTCUT_ID)
                        .setShortLabel(getContext().getString(R.string.app_name)).setIcon(icon).setIntent(intent).build();
                    if (pinned) manager.updateShortcuts(Collections.singletonList(info));
                    else requested = manager.requestPinShortcut(info, null);
                }
                JSObject result = new JSObject(); result.put("supported", supported); result.put("pinned", pinned); result.put("requested", requested); call.resolve(result);
            } catch (Exception error) { call.reject("桌面图标暂时无法更新，请检查桌面是否允许添加快捷方式", error); }
        });
    }
}
