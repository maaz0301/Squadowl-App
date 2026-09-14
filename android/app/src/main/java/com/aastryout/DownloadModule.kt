package com.aastryout

import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * Saves an already-written cache file straight into the device's public
 * Downloads collection via MediaStore, and opens it with an ACTION_VIEW
 * intent scoped to that one file.
 *
 * MediaStore.Downloads needs no storage permission from API 29 onward, unlike
 * a plain File write to the public Downloads path, which scoped storage
 * rejects on any device actually running that OS version. Devices older than
 * API 29 are left to saveToDownloads's caller, which falls back to the share
 * sheet instead of requesting WRITE_EXTERNAL_STORAGE for a shrinking sliver
 * of installs.
 */
class DownloadModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "AADownloadModule"

  @ReactMethod
  fun saveToDownloads(sourcePath: String, fileName: String, mimeType: String, promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      promise.reject("UNSUPPORTED", "Direct Downloads save needs Android 10 or newer.")
      return
    }
    try {
      val resolver = reactApplicationContext.contentResolver
      val values = ContentValues().apply {
        put(MediaStore.Downloads.DISPLAY_NAME, fileName)
        put(MediaStore.Downloads.MIME_TYPE, mimeType)
        put(MediaStore.Downloads.IS_PENDING, 1)
      }

      val itemUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
        ?: throw Exception("Could not create a Downloads entry")

      val out = resolver.openOutputStream(itemUri)
        ?: throw Exception("Could not open the Downloads entry for writing")
      out.use { stream ->
        File(sourcePath).inputStream().use { input -> input.copyTo(stream) }
      }

      values.clear()
      values.put(MediaStore.Downloads.IS_PENDING, 0)
      resolver.update(itemUri, values, null, null)

      promise.resolve(itemUri.toString())
    } catch (e: Exception) {
      promise.reject("SAVE_FAILED", e.message, e)
    }
  }

  /** Resolves `true` if something on the device could view the file, `false` if nothing could — never rejects for that case, since the save itself already succeeded by the time this runs. */
  @ReactMethod
  fun openDownloadedFile(uriString: String, mimeType: String, promise: Promise) {
    try {
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(Uri.parse(uriString), mimeType)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      val context = reactApplicationContext
      if (intent.resolveActivity(context.packageManager) != null) {
        context.startActivity(intent)
        promise.resolve(true)
      } else {
        promise.resolve(false)
      }
    } catch (e: Exception) {
      promise.reject("OPEN_FAILED", e.message, e)
    }
  }
}
