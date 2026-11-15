param(
    [int]$Port = 8080
)

$Host.UI.RawUI.WindowTitle = "Phone-to-PC Screen Mirror Server [Port $Port]"
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "    APP CHIEU MAN HINH DIEN THOAI LEN PC (SCREEN MIRROR)  " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

$CurrentDir = $PSScriptRoot
if (-not $CurrentDir) { $CurrentDir = Get-Location }

$UsersFile = Join-Path $CurrentDir "assets\data\users.json"
if (-not (Test-Path $UsersFile)) { "[]" | Out-File -FilePath $UsersFile -Encoding utf8 }

# In-memory Mirror Sessions & Signals
$MirrorSessions = @{} # code -> @{ user = ""; created = Get-Date; signals = @() }
$FrameRelay = @{}     # code -> frame base64 for fallback

# Determine local IPv4
$LocalIP = "localhost"
try {
    $ipConfig = ipconfig
    $matchedLine = $ipConfig | Select-String -Pattern "IPv4 Address[ .:]+([\d\.]+)" | Select-Object -First 1
    if ($matchedLine -and $matchedLine.Matches[0].Groups[1].Value) {
        $LocalIP = $matchedLine.Matches[0].Groups[1].Value.Trim()
    }
} catch {}

$listener = New-Object System.Net.HttpListener
$prefixLocal = "http://localhost:$Port/"
$listener.Prefixes.Add($prefixLocal)

# Try adding IP prefix if permissions allow
try {
    if ($LocalIP -ne "localhost") {
        $prefixIP = "http://$($LocalIP):$Port/"
        $listener.Prefixes.Add($prefixIP)
    }
} catch {}

try {
    $listener.Start()
} catch {
    Write-Host "Port $Port busy, trying 8081..." -ForegroundColor Yellow
    $Port = 8081
    $listener = New-Object System.Net.HttpListener
    $prefixLocal = "http://localhost:$Port/"
    $listener.Prefixes.Add($prefixLocal)
    $listener.Start()
}

Write-Host "Máy chủ đang chạy tại: $prefixLocal" -ForegroundColor Green
if ($LocalIP -ne "localhost") {
    Write-Host "Địa chỉ mở trên điện thoại (cùng WiFi): http://$($LocalIP):$Port" -ForegroundColor Cyan
}
Write-Host "Đang mở trình duyệt..." -ForegroundColor Gray
Start-Process $prefixLocal

function Get-MimeType($ext) {
    switch ($ext.ToLower()) {
        ".html" { return "text/html; charset=utf-8" }
        ".htm"  { return "text/html; charset=utf-8" }
        ".css"  { return "text/css; charset=utf-8" }
        ".js"   { return "application/javascript; charset=utf-8" }
        ".json" { return "application/json; charset=utf-8" }
        ".png"  { return "image/png" }
        ".jpg"  { return "image/jpeg" }
        ".jpeg" { return "image/jpeg" }
        ".svg"  { return "image/svg+xml" }
        ".ico"  { return "image/x-icon" }
        ".webm" { return "video/webm" }
        ".mp4"  { return "video/mp4" }
        default { return "application/octet-stream" }
    }
}

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $response.AddHeader("Access-Control-Allow-Origin", "*")
        $response.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        $response.AddHeader("Access-Control-Allow-Headers", "Content-Type")

        if ($request.HttpMethod -eq "OPTIONS") {
            $response.StatusCode = 200
            $response.Close()
            continue
        }

        $urlPath = $request.Url.LocalPath
        $bodyText = ""
        if ($request.HasEntityBody) {
            $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
            $bodyText = $reader.ReadToEnd()
            $reader.Close()
        }

        # API Handlers
        if ($urlPath.StartsWith("/api/")) {
            $response.ContentType = "application/json; charset=utf-8"
            $jsonOut = "{}"

            try {
                if ($urlPath -eq "/api/info") {
                    $jsonOut = @{
                        localIP = $LocalIP
                        port = $Port
                        phoneUrl = "http://$($LocalIP):$Port"
                    } | ConvertTo-Json
                }
                elseif ($urlPath -eq "/api/register" -and $request.HttpMethod -eq "POST") {
                    $reqObj = $bodyText | ConvertFrom-Json
                    $uName = $reqObj.username.Trim().ToLower()
                    $uPass = $reqObj.password
                    $dName = if ($reqObj.name) { $reqObj.name } else { $uName }

                    $raw = [System.IO.File]::ReadAllText($UsersFile, [System.Text.Encoding]::UTF8)
                    $users = @()
                    if ($raw -and $raw.Trim() -ne "[]") {
                        $users = @($raw | ConvertFrom-Json)
                    }

                    $exists = $users | Where-Object { $_.username.ToLower() -eq $uName }
                    if ($exists) {
                        $response.StatusCode = 400
                        $jsonOut = @{ success = $false; message = "Tên tài khoản này đã được sử dụng! Hãy chọn tên khác." } | ConvertTo-Json
                    } else {
                        $newUser = @{
                            username = $uName
                            password = $uPass
                            name = $dName
                        }
                        $users += $newUser
                        $updated = $users | ConvertTo-Json -Depth 5
                        [System.IO.File]::WriteAllText($UsersFile, $updated, [System.Text.Encoding]::UTF8)
                        $jsonOut = @{ success = $true; user = $newUser } | ConvertTo-Json
                    }
                }
                elseif ($urlPath -eq "/api/login" -and $request.HttpMethod -eq "POST") {
                    $reqObj = $bodyText | ConvertFrom-Json
                    $uName = $reqObj.username.Trim().ToLower()
                    $uPass = $reqObj.password

                    $raw = [System.IO.File]::ReadAllText($UsersFile, [System.Text.Encoding]::UTF8)
                    $users = @()
                    if ($raw -and $raw.Trim() -ne "[]") {
                        $users = @($raw | ConvertFrom-Json)
                    }
                    $matched = $users | Where-Object { $_.username.ToLower() -eq $uName -and $_.password -eq $uPass }
                    if ($matched) {
                        $jsonOut = @{ success = $true; user = @{ username = $matched.username; name = $matched.name } } | ConvertTo-Json
                    } else {
                        $response.StatusCode = 401
                        $jsonOut = @{ success = $false; message = "Tên đăng nhập hoặc mật khẩu không chính xác!" } | ConvertTo-Json
                    }
                }
                # MIRROR CODES & WEBRTC SIGNALING
                elseif ($urlPath -eq "/api/mirror/register-code" -and $request.HttpMethod -eq "POST") {
                    $reqObj = $bodyText | ConvertFrom-Json
                    $code = $reqObj.code.Trim()
                    $MirrorSessions[$code] = @{
                        code = $code
                        user = $reqObj.username
                        active = $true
                        created = (Get-Date)
                        signalsToPC = [System.Collections.ArrayList]@()
                        signalsToPhone = [System.Collections.ArrayList]@()
                    }
                    $jsonOut = @{ success = $true; code = $code } | ConvertTo-Json
                }
                elseif ($urlPath -eq "/api/mirror/check-code" -and $request.HttpMethod -eq "GET") {
                    $code = $request.QueryString["code"]
                    if ($code -and $MirrorSessions.ContainsKey($code)) {
                        $jsonOut = @{ success = $true; found = $true; session = $MirrorSessions[$code] } | ConvertTo-Json
                    } else {
                        $jsonOut = @{ success = $false; found = $false; message = "Mã kết nối không hợp lệ hoặc điện thoại chưa sẵn sàng!" } | ConvertTo-Json
                    }
                }
                elseif ($urlPath -eq "/api/mirror/signal" -and $request.HttpMethod -eq "POST") {
                    $sig = $bodyText | ConvertFrom-Json
                    $code = $sig.code
                    if ($code -and $MirrorSessions.ContainsKey($code)) {
                        $target = $sig.target # 'pc' or 'phone'
                        if ($target -eq "pc") {
                            [void]$MirrorSessions[$code].signalsToPC.Add($sig.payload)
                        } else {
                            [void]$MirrorSessions[$code].signalsToPhone.Add($sig.payload)
                        }
                        $jsonOut = @{ success = $true } | ConvertTo-Json
                    } else {
                        $response.StatusCode = 404
                        $jsonOut = @{ success = $false; message = "Phiên kết nối không tồn tại!" } | ConvertTo-Json
                    }
                }
                elseif ($urlPath -eq "/api/mirror/signal" -and $request.HttpMethod -eq "GET") {
                    $code = $request.QueryString["code"]
                    $role = $request.QueryString["role"] # 'pc' or 'phone'
                    $items = @()
                    if ($code -and $MirrorSessions.ContainsKey($code)) {
                        if ($role -eq "pc") {
                            $items = @($MirrorSessions[$code].signalsToPC)
                            $MirrorSessions[$code].signalsToPC.Clear()
                        } else {
                            $items = @($MirrorSessions[$code].signalsToPhone)
                            $MirrorSessions[$code].signalsToPhone.Clear()
                        }
                    }
                    $jsonOut = $items | ConvertTo-Json -Depth 5
                }
                # FRAME RELAY FOR FALLBACK
                elseif ($urlPath -eq "/api/mirror/frame" -and $request.HttpMethod -eq "POST") {
                    $reqObj = $bodyText | ConvertFrom-Json
                    $code = $reqObj.code
                    $FrameRelay[$code] = $reqObj.frame
                    $jsonOut = @{ success = $true } | ConvertTo-Json
                }
                elseif ($urlPath -eq "/api/mirror/frame" -and $request.HttpMethod -eq "GET") {
                    $code = $request.QueryString["code"]
                    $frame = ""
                    if ($code -and $FrameRelay.ContainsKey($code)) {
                        $frame = $FrameRelay[$code]
                    }
                    $jsonOut = @{ frame = $frame } | ConvertTo-Json
                }
                else {
                    $response.StatusCode = 404
                    $jsonOut = @{ error = "Not found" } | ConvertTo-Json
                }
            } catch {
                $response.StatusCode = 500
                $jsonOut = @{ error = $_.Exception.Message } | ConvertTo-Json
            }

            $buffer = [System.Text.Encoding]::UTF8.GetBytes($jsonOut)
            $response.ContentLength64 = $buffer.Length
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
            $response.Close()
            continue
        }

        # Serve static files
        $relPath = $urlPath.TrimStart('/')
        if ($relPath -eq "" -or $relPath -eq "/") { $relPath = "index.html" }
        $filePath = Join-Path $CurrentDir $relPath.Replace('/', '\')

        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath)
            $response.ContentType = Get-MimeType $ext
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $notFound = [System.Text.Encoding]::UTF8.GetBytes("<h1>404 Not Found: $relPath</h1>")
            $response.ContentLength64 = $notFound.Length
            $response.OutputStream.Write($notFound, 0, $notFound.Length)
        }
        $response.Close()
    } catch {
        # Keep listening
    }
}
