package com.screenmirror.sender

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private lateinit var serverInput: EditText
    private lateinit var codeLabel: TextView
    private lateinit var statusLabel: TextView
    private val requestExecutor = Executors.newSingleThreadExecutor()
    private val random = SecureRandom()
    private var activeCode: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildScreen()

        val preferences = getSharedPreferences("screen_mirror_sender", MODE_PRIVATE)
        serverInput.setText(preferences.getString("server_url", ""))
        activeCode = preferences.getString("active_code", null)
        showCode()
    }

    private fun buildScreen() {
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(28), dp(24), dp(28))
            setBackgroundColor(0xFF070D17.toInt())
        }

        content.addView(TextView(this).apply {
            text = "SCREEN MIRROR SENDER"
            textSize = 23f
            setTextColor(0xFF00D2FF.toInt())
            gravity = Gravity.CENTER
        }, matchWidth())

        content.addView(TextView(this).apply {
            text = "Nhập URL HTTPS của server Render, tạo mã rồi bắt đầu chia sẻ màn hình."
            textSize = 15f
            setTextColor(0xFFEAF2FF.toInt())
            gravity = Gravity.CENTER
            setPadding(0, dp(12), 0, dp(20))
        }, matchWidth())

        serverInput = EditText(this).apply {
            hint = "https://ten-app.onrender.com"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true)
            setTextColor(0xFF101820.toInt())
            setHintTextColor(0xFF657180.toInt())
            setPadding(dp(12), 0, dp(12), 0)
        }
        content.addView(serverInput, matchWidth(dp(52)))

        val createCodeButton = makeButton("Tạo mã kết nối")
        content.addView(createCodeButton, buttonLayout())
        createCodeButton.setOnClickListener { createCode() }

        codeLabel = TextView(this).apply {
            textSize = 25f
            setTextColor(0xFF00D2FF.toInt())
            gravity = Gravity.CENTER
            setPadding(0, dp(20), 0, dp(14))
        }
        content.addView(codeLabel, matchWidth())

        val startButton = makeButton("Bắt đầu chia sẻ màn hình")
        content.addView(startButton, buttonLayout())
        startButton.setOnClickListener { requestScreenCapture() }

        val stopButton = makeButton("Dừng chia sẻ")
        content.addView(stopButton, buttonLayout())
        stopButton.setOnClickListener {
            stopService(Intent(this, ScreenCaptureService::class.java))
            statusLabel.text = "Đã dừng chia sẻ."
        }

        statusLabel = TextView(this).apply {
            text = "Mở cùng URL trên PC, chọn chế độ PC và nhập mã bên trên."
            textSize = 14f
            setTextColor(0xFFEAF2FF.toInt())
            gravity = Gravity.CENTER
            setPadding(0, dp(18), 0, 0)
        }
        content.addView(statusLabel, matchWidth())

        val scrollView = ScrollView(this).apply {
            isFillViewport = true
            addView(content)
        }
        setContentView(scrollView)
    }

    private fun createCode() {
        val serverUrl = normalizedServerUrl() ?: return
        val code = buildString {
            repeat(6) {
                append(CODE_CHARS[random.nextInt(CODE_CHARS.length)])
            }
        }

        statusLabel.text = "Đang kết nối server để tạo mã..."
        serverInput.isEnabled = false
        requestExecutor.execute {
            try {
                val response = postJson(
                    "$serverUrl/api/mirror/register-code",
                    JSONObject()
                        .put("code", code)
                        .put("username", "android_sender")
                )
                if (!response.optBoolean("success")) {
                    throw IOException("Server không tạo được mã kết nối.")
                }

                activeCode = code
                getSharedPreferences("screen_mirror_sender", MODE_PRIVATE).edit()
                    .putString("server_url", serverUrl)
                    .putString("active_code", code)
                    .apply()

                runOnUiThread {
                    serverInput.isEnabled = true
                    showCode()
                    statusLabel.text = "Nhập mã này trên PC, sau đó bắt đầu chia sẻ."
                }
            } catch (error: Exception) {
                runOnUiThread {
                    serverInput.isEnabled = true
                    statusLabel.text = "Không tạo được mã: ${error.message ?: "lỗi kết nối"}"
                }
            }
        }
    }

    private fun requestScreenCapture() {
        val serverUrl = normalizedServerUrl() ?: return
        val code = activeCode
        if (code.isNullOrBlank()) {
            statusLabel.text = "Hãy tạo mã kết nối trước."
            return
        }

        getSharedPreferences("screen_mirror_sender", MODE_PRIVATE).edit()
            .putString("server_url", serverUrl)
            .apply()

        val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(manager.createScreenCaptureIntent(), REQUEST_SCREEN_CAPTURE)
    }

    @Deprecated("Uses the MediaProjection consent result returned by Android.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_SCREEN_CAPTURE) return

        if (resultCode != RESULT_OK || data == null) {
            statusLabel.text = "Bạn đã hủy quyền chia sẻ màn hình."
            return
        }

        val serviceIntent = Intent(this, ScreenCaptureService::class.java).apply {
            putExtra(ScreenCaptureService.EXTRA_SERVER_URL, normalizedServerUrl())
            putExtra(ScreenCaptureService.EXTRA_CODE, activeCode)
            putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, resultCode)
            putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, data)
        }
        startForegroundService(serviceIntent)
        statusLabel.text = "Đang gửi màn hình tới PC. Có thể chuyển sang ứng dụng khác."
    }

    private fun normalizedServerUrl(): String? {
        var value = serverInput.text.toString().trim().trimEnd('/')
        if (value.isBlank()) {
            statusLabel.text = "Nhập URL HTTPS của server trước."
            return null
        }
        if (!value.contains("://")) value = "https://$value"

        val parsed = try {
            URL(value)
        } catch (_: Exception) {
            statusLabel.text = "URL server không hợp lệ."
            return null
        }

        val hasPath = parsed.path.isNotEmpty() && parsed.path != "/"
        if (parsed.protocol != "https" || parsed.host.isBlank() || hasPath || value.contains("?") || value.contains("#")) {
            statusLabel.text = "Hãy nhập URL HTTPS gốc của server, không có đường dẫn hay tham số."
            return null
        }
        return value
    }

    private fun postJson(url: String, payload: JSONObject): JSONObject {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 15_000
            connection.readTimeout = 60_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }

            val status = connection.responseCode
            val responseStream = if (status in 200..299) connection.inputStream else connection.errorStream
            val body = responseStream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (status !in 200..299) throw IOException("HTTP $status ${body.take(120)}")
            return JSONObject(body)
        } finally {
            connection.disconnect()
        }
    }

    private fun showCode() {
        codeLabel.text = activeCode?.let { "Mã kết nối: $it" } ?: "Chưa có mã kết nối"
    }

    private fun makeButton(label: String) = Button(this).apply {
        text = label
        setTextColor(0xFFFFFFFF.toInt())
        backgroundTintList = android.content.res.ColorStateList.valueOf(0xFF0077B6.toInt())
    }

    private fun matchWidth(height: Int = ViewGroup.LayoutParams.WRAP_CONTENT) =
        LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, height)

    private fun buttonLayout() = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
    ).apply {
        topMargin = dp(12)
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        requestExecutor.shutdownNow()
        super.onDestroy()
    }

    companion object {
        private const val REQUEST_SCREEN_CAPTURE = 4102
        private const val CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
    }
}
