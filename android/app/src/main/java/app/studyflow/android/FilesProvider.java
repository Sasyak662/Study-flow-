package app.studyflow.android;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

/** Lets a PDF viewer open papers the app saved (only files in the app's own cache "files" folder). */
public class FilesProvider extends ContentProvider {
    static final String AUTH = "app.studyflow.android.files";
    static File dir(android.content.Context c) { File d = new File(c.getCacheDir(), "files"); d.mkdirs(); return d; }
    private File file(Uri u) throws FileNotFoundException {
        String n = u.getLastPathSegment();
        if (n == null || n.contains("/") || n.contains("..")) throw new FileNotFoundException();
        File f = new File(dir(getContext()), n);
        if (!f.exists()) throw new FileNotFoundException();
        return f;
    }
    @Override public boolean onCreate() { return true; }
    @Override public ParcelFileDescriptor openFile(Uri u, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(file(u), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public String getType(Uri u) {
        String n = String.valueOf(u.getLastPathSegment()).toLowerCase();
        return n.endsWith(".pdf") ? "application/pdf" : n.endsWith(".csv") ? "text/csv" : "text/plain";
    }
    @Override public Cursor query(Uri u, String[] p, String s, String[] a, String o) {
        try {
            File f = file(u);
            MatrixCursor c = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
            c.addRow(new Object[]{f.getName(), f.length()});
            return c;
        } catch (Exception e) { return null; }
    }
    @Override public Uri insert(Uri u, ContentValues v) { return null; }
    @Override public int delete(Uri u, String s, String[] a) { return 0; }
    @Override public int update(Uri u, ContentValues v, String s, String[] a) { return 0; }
}
