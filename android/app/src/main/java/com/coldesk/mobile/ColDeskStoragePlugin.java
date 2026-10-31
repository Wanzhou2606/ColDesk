package com.coldesk.mobile;
import android.util.AtomicFile;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/** 使用安卓私有目录与 AtomicFile；写入失败时恢复上一份记录。 */
@CapacitorPlugin(name = "ColDeskStore")
public class ColDeskStoragePlugin extends Plugin {
    private AtomicFile stateFile() {
        File directory = new File(getContext().getFilesDir(), "coldesk");
        if (!directory.exists()) directory.mkdirs();
        return new AtomicFile(new File(directory, "state.json"));
    }
    @PluginMethod
    public void load(PluginCall call) {
        execute(() -> {
            try {
                byte[] bytes = stateFile().readFully();
                if (bytes.length > 150L * 1024 * 1024) { call.reject("本机记录过大，请保留应用并联系维护者。"); return; }
                JSObject value = new JSObject(); value.put("data", new String(bytes, StandardCharsets.UTF_8)); call.resolve(value);
            } catch (FileNotFoundException missing) {
                JSObject empty = new JSObject(); empty.put("data", JSONObjectNull()); call.resolve(empty);
            } catch (Exception error) { call.reject("本机记录暂时无法读取，请保留应用并重试。"); }
        });
    }
    private Object JSONObjectNull() { return org.json.JSONObject.NULL; }
    @PluginMethod
    public void save(PluginCall call) {
        String data = call.getString("data");
        if (data == null || data.length() > 150L * 1024 * 1024) { call.reject("记录无法保存，请检查内容大小。"); return; }
        execute(() -> {
            AtomicFile file = stateFile(); FileOutputStream output = null;
            try {
                byte[] bytes = data.getBytes(StandardCharsets.UTF_8);
                if (bytes.length > 150L * 1024 * 1024) { call.reject("记录无法保存，请先整理附件。"); return; }
                output = file.startWrite(); output.write(bytes); file.finishWrite(output); call.resolve();
            } catch (Exception error) { if (output != null) file.failWrite(output); call.reject("保存未完成，请检查手机剩余空间后重试。"); }
        });
    }
}
