package com.screenmirror.sender

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.SystemClock
import android.util.Base64
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class ScreenCaptureService : Service() {
    private val uploadExecutor = Executors.newSingleThreadExecutor()
    private val uploadPending = AtomicBoolean(false)
    private lateinit var captureThread: HandlerThread
    private lateinit var captureHandler: Handler
    private var projection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var serverUrl = ""
    private var connectionCode = ""
    private var lastFrameAt = 0L
    private var lastErrorNotificationAt = 0L
    private var stopping = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        captureThread = HandlerThread("screen-mirror-capture").apply { start() }
        captureHandler = Handler(captureThread.looper)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (projection != null) return START_NOT_STICKY

        serverUrl = intent?.getStringExtra(EXTRA_SERVER_URL).orEmpty().trimEnd('/')
        connectionCode = intent?.getStringExtra(EXTRA_CODE).orEmpty()
        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, 0) ?: 0
        val resultData = getResultData(intent)
        if (serverUrl.isBlank() || connectionCode.isBlank() || resultData == null) {
            stopSelf()
            return START_NOT_STICKY
        }

        startForegroundCompat(buildNotification("Đang khởi tạo chia sẻ màn hình"))
        try {
            val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            projection = manager.getMediaProjection(resultCode, resultData)
            projection?.registerCallback(projectionCallback, captureHandler)
            createVirtualDisplay()
            updateNotification("Đang gửi màn hình tới PC")
        } catch (error: Exception) {
            Log.e(TAG, "Không thể bắt đầu capture", error)
            updateNotification("Không bắt đầu được: ${error.message ?: "lỗi hệ thống"}")
            stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun createVirtualDisplay() {
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        (getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay.getRealMetrics(metrics)
        val width = metrics.widthPixels
        val height = metrics.heightPixels
        if (width <= 0 || height <= 0) throw IOException("Không đọc được kích thước màn hình")

        val reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
        imageReader = reader
        reader.setOnImageAvailableListener({ source -> captureFrame(source) }, captureHandler)
        virtualDisplay = projection?.createVirtualDisplay(
            "Screen Mirror Sender",
            width,
            height,
            metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader.surface,
            null,
            captureHandler
        )
        if (virtualDisplay == null) throw IOException("Không tạo được màn hình ảo")
    }

    private fun captureFrame(source: ImageReader) {
        val image = try {
            source.acquireLatestImage()
        } catch (error: Exception) {
            reportError("Không đọc được khung hình: ${error.message}")
            return
        } ?: return

        val now = SystemClock.elapsedRealtime()
        if (now - lastFrameAt < FRAME_INTERVAL_MS || !uploadPending.compareAndSet(false, true)) {
            image.close()
            return
        }
        lastFrameAt = now

        val bitmap = try {
            imageToBitmap(image)
        } catch (error: Exception) {
            uploadPending.set(false)
            reportError("Không xử lý được khung hình: ${error.message}")
            image.close()
            return
        }
        image.close()

        try {
            uploadExecutor.execute {
                try {
                    uploadFrame(bitmap)
                } catch (error: Exception) {
                    Log.w(TAG, "Không gửi được khung hình", error)
                    reportError("Không gửi được hình: ${error.message ?: "kiểm tra URL/server"}")
                } finally {
                    bitmap.recycle()
                    uploadPending.set(false)
                }
            }
        } catch (error: Exception) {
            bitmap.recycle()
            uploadPending.set(false)
            reportError("Không thể xử lý khung hình: ${error.message}")
        }
    }

    private fun imageToBitmap(image: Image): Bitmap {
        val plane = image.planes.first()
        val paddedWidth = (plane.rowStride + plane.pixelStride - 1) / plane.pixelStride
        val padded = Bitmap.createBitmap(paddedWidth, image.height, Bitmap.Config.ARGB_8888)
        padded.copyPixelsFromBuffer(plane.buffer)

        val cropped = if (paddedWidth == image.width) {
            padded
        } else {
            Bitmap.createBitmap(padded, 0, 0, image.width, image.height).also { padded.recycle() }
        }

        val scale = minOf(1f, 720f / cropped.width, 1280f / cropped.height)
        if (scale >= 1f) return cropped

        val resized = Bitmap.createScaledBitmap(
            cropped,
            (cropped.width * scale).toInt().coerceAtLeast(1),
            (cropped.height * scale).toInt().coerceAtLeast(1),
            true
        )
        if (resized !== cropped) cropped.recycle()
        return resized
    }

    private fun uploadFrame(bitmap: Bitmap) {
        val imageBytes = ByteArrayOutputStream().use { output ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, output)
            output.toByteArray()
        }
        val dataUrl = "data:image/jpeg;base64," + Base64.encodeToString(imageBytes, Base64.NO_WRAP)
        val payload = JSONObject()
            .put("code", connectionCode)
            .put("frame", dataUrl)

        val connection = URL("$serverUrl/api/mirror/frame").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 8_000
            connection.readTimeout = 8_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty("Cache-Control", "no-store")
            connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }

            val status = connection.responseCode
            if (status !in 200..299) {
                val message = connection.errorStream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
                throw IOException("HTTP $status ${message.orEmpty().take(100)}")
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun reportError(message: String) {
        val now = SystemClock.elapsedRealtime()
        if (now - lastErrorNotificationAt < ERROR_NOTIFICATION_INTERVAL_MS) return
        lastErrorNotificationAt = now
        updateNotification(message.take(120))
    }

    private fun startForegroundCompat(notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(message: String): Notification {
        val stopIntent = Intent(this, ScreenCaptureService::class.java).setAction(ACTION_STOP)
        val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val stopPendingIntent = PendingIntent.getService(this, 0, stopIntent, pendingFlags)

        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentTitle("Screen Mirror Sender")
            .setContentText(message)
            .setOngoing(true)
            .addAction(0, "Dừng", stopPendingIntent)
            .build()
    }

    private fun updateNotification(message: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, buildNotification(message))
    }

    private fun createNotificationChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Chia sẻ màn hình",
                NotificationManager.IMPORTANCE_LOW
            )
        )
    }

    private fun getResultData(intent: Intent?): Intent? {
        if (intent == null) return null
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(EXTRA_RESULT_DATA)
        }
    }

    private fun stopCapture() {
        if (stopping) return
        stopping = true
        imageReader?.setOnImageAvailableListener(null, null)
        virtualDisplay?.release()
        virtualDisplay = null
        imageReader?.close()
        imageReader = null
        projection?.unregisterCallback(projectionCallback)
        projection?.stop()
        projection = null
    }

    override fun onDestroy() {
        stopCapture()
        uploadExecutor.shutdownNow()
        if (::captureThread.isInitialized) captureThread.quitSafely()
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() {
            stopSelf()
        }
    }

    companion object {
        const val EXTRA_SERVER_URL = "server_url"
        const val EXTRA_CODE = "connection_code"
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_RESULT_DATA = "result_data"
        private const val ACTION_STOP = "com.screenmirror.sender.STOP"
        private const val CHANNEL_ID = "screen_mirror_capture"
        private const val NOTIFICATION_ID = 4103
        private const val TAG = "ScreenCaptureService"
        private const val FRAME_INTERVAL_MS = 200L
        private const val ERROR_NOTIFICATION_INTERVAL_MS = 5_000L
        private const val JPEG_QUALITY = 55
    }
}
