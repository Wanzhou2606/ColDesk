package com.coldesk.mobile;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ColDeskExportPlugin.class);
        registerPlugin(ColDeskStoragePlugin.class);
        registerPlugin(ColDeskAppearancePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
