package com.coldesk.mobile;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import android.view.WindowManager;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

/** 系统文件夹选择器：用户选择位置后才写入导出的文件，不需要广泛存储权限。 */
@CapacitorPlugin(name = "ColDeskExport")
public class ColDeskExportPlugin extends Plugin {
    @PluginMethod
    public void save(PluginCall call) {
        JSArray files = call.getArray("files");
        if (files == null || files.length() == 0 || files.length() > 500) { call.reject("请选择有效的导出内容"); return; }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        startActivityForResult(call, intent, "folderPicked");
    }
    @PluginMethod
    public void privacy(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getActivity().runOnUiThread(() -> {
            if (enabled) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            call.resolve();
        });
    }
    private String clean(String name) { return name.replaceAll("[<>:\"/\\\\|?*\\p{Cntrl}]", "_"); }
    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject canceled = new JSObject(); canceled.put("canceled", true); call.resolve(canceled); return;
        }
        Uri tree = result.getData().getData();
        getBridge().execute(() -> {
            Uri folder = null;
            try {
                Uri root = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
                String name = clean(call.getString("folderName", "ColDesk导出")) + "-" + System.currentTimeMillis();
                folder = DocumentsContract.createDocument(getContext().getContentResolver(), root, DocumentsContract.Document.MIME_TYPE_DIR, name);
                if (folder == null) throw new Exception("Folder unavailable");
                Map<String, Uri> directories = new HashMap<>(); directories.put("", folder);
                JSArray files = call.getArray("files"); long total = 0;
                for (int index = 0; index < files.length(); index++) {
                    JSONObject file = files.getJSONObject(index);
                    String relative = file.getString("name");
                    if (relative.startsWith("/") || relative.contains("\\") || relative.contains("..") || relative.length() > 300) throw new Exception("Invalid file name");
                    String[] parts = relative.split("/");
                    if (parts.length > 3) throw new Exception("Invalid directory");
                    Uri parent = folder; String path = "";
                    for (int i = 0; i < parts.length - 1; i++) {
                        path += "/" + clean(parts[i]);
                        Uri child = directories.get(path);
                        if (child == null) { child = DocumentsContract.createDocument(getContext().getContentResolver(), parent, DocumentsContract.Document.MIME_TYPE_DIR, clean(parts[i])); if (child == null) throw new Exception("Cannot create folder"); directories.put(path, child); }
                        parent = child;
                    }
                    byte[] bytes = Base64.decode(file.getString("data"), Base64.DEFAULT); total += bytes.length;
                    if (total > 150L * 1024 * 1024) throw new Exception("Export too large");
                    Uri document = DocumentsContract.createDocument(getContext().getContentResolver(), parent, file.optString("mime", "application/octet-stream"), clean(parts[parts.length - 1]));
                    if (document == null) throw new Exception("Cannot create document");
                    try (OutputStream stream = getContext().getContentResolver().openOutputStream(document, "w")) { if (stream == null) throw new Exception("Cannot write document"); stream.write(bytes); }
                }
                JSObject success = new JSObject(); success.put("canceled", false); success.put("folder", "已保存到所选文件夹 / " + name); call.resolve(success);
            } catch (Exception error) {
                call.reject("导出未完成，可能已生成部分文件。请检查剩余空间或选择其他文件夹。");
            }
        });
    }
}
