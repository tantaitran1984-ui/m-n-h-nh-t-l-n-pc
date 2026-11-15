# Screen Mirror Sender for Android

Android Chrome does not expose whole-screen capture to web pages. This native companion uses Android's MediaProjection permission and sends JPEG frames to the same Node server used by the PC page.

## Build the APK

1. Install Android Studio and JDK 17.
2. Open this `android` folder as a project and let Gradle sync.
3. Choose **Build > Build App Bundle(s) / APK(s) > Build APK(s)**.
4. Install `app/build/outputs/apk/debug/app-debug.apk` on the Android phone.

This repository environment has no Android SDK or JDK, so an APK cannot be built here; the Android source project is ready for Android Studio.

## Use it

1. Deploy the repository as a Render **Web Service** using its existing `render.yaml`; use the HTTPS service URL.
2. Open the same URL on the PC, choose **Máy tính**, and leave the six-character code input ready.
3. Open **Screen Mirror Sender** on Android, enter the HTTPS service URL, and tap **Tạo mã kết nối**.
4. Enter the displayed code on the PC and connect.
5. On Android, tap **Bắt đầu chia sẻ màn hình**, approve Android's screen-capture prompt, select the whole screen, and confirm **Start now**.
6. Keep the foreground notification active while sharing. Tap **Dừng chia sẻ** in the app or its notification to stop.

The companion sends a reduced-size JPEG frame every 200 ms to `/api/mirror/frame`. The PC page receives frames using the existing code. The Node service must be reachable over HTTPS and run as a single instance because its mirror-code and frame-relay state is in memory.
