# FileBridge - Nền tảng chuyển file P2P bảo mật

**FileBridge** là nền tảng chuyển file peer-to-peer (P2P) với mã hóa đầu cuối (E2E encryption), cho phép người dùng chia sẻ file trực tiếp giữa các thiết bị qua trình duyệt web mà không cần upload lên cloud server trung gian.

## Tính năng chính

- **P2P Direct Transfer**: File truyền trực tiếp device-to-device qua WebRTC DataChannel
- **E2E Encryption**: Mã hóa AES-256-GCM với ECDH key exchange
- **Cross-Network**: Hỗ trợ truyền qua Internet toàn cầu, không chỉ cùng mạng LAN
- **Anonymous Mode**: Không cần đăng ký, chỉ cần tạo/join phòng bằng mã 6 ký tự
- **Drag & Drop**: Hỗ trợ thư mục, ảnh, mọi loại file
- **Web App PWA**: Chạy trên trình duyệt, responsive, hoạt động offline
- **Multi-fallback**: Tự động chuyển sang WebSocket → HTTP khi WebRTC bị chặn

## Kiến trúc Hybrid Transfer

```
┌─────────────────────────────────────────────────────────────┐
│                    Connection Flow                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. THỬ WebRTC P2P (ưu tiên)                              │
│     └─> STUN Server (Google) → Kết nối trực tiếp           │
│                                                             │
│  2. THỬ Local PeerJS Server (không cần Internet)          │
│     └─> Cùng LAN → Hoạt động không cần mạng                │
│                                                             │
│  3. THỬ WebSocket Relay (TCP fallback)                     │
│     └─> Khi UDP bị chặn → Dùng port 80/443                 │
│                                                             │
│  4. HTTP Upload (emergency backup)                          │
│     └─> Khi mọi thứ fail → Relay qua HTTP                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Security Model                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  🔒 Server chỉ relay metadata (SDP, ICE)                   │
│  🔒 KHÔNG BAO GIỜ chạm vào nội dung file                    │
│  🔒 KHÔNG lưu trữ file trên server                        │
│  🔒 KHÔNG dùng Redis - chỉ in-memory                       │
│  🔒 KHÔNG database - session không cần lưu               │
│                                                             │
│  ✅ AES-256-GCM mã hóa file trước khi gửi                 │
│  ✅ ECDH key exchange - key chỉ có sender/receiver biết    │
│  ✅ Perfect Forward Secrecy - mỗi phiên dùng key khác nhau   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Công nghệ sử dụng

| Lớp | Công nghệ |
|------|-----------|
| **Frontend** | React 18 + TypeScript + Vite + Tailwind CSS |
| **P2P Engine** | PeerJS (WebRTC) + Web Crypto API |
| **Signaling** | Socket.IO WebSocket (in-memory, không Redis) |
| **State** | Zustand |
| **STUN** | Google STUN + Open Relay Project (miễn phí) |

## Cài đặt

```bash
# 1. Cài frontend
cd filebridge-mvp
npm install

# 2. Cài signaling server
cd server
npm install
```

## Chạy ứng dụng

```bash
# Terminal 1: Signaling Server (luôn chạy trước)
cd server
npm start

# Terminal 2: Frontend
cd ..
npm run dev
```

Truy cập http://localhost:3000

## Demo không cần Internet

```bash
# Trên máy presenter, chạy signaling server
cd server
npm start

# Trên cùng LAN, mọi người truy cập:
# http://<ip-may-presenter>:3000

# App sẽ tự kết nối Local PeerJS Server thay vì PeerJS Cloud
```

## Hỗ trợ nhiều loại file

| Loại | Ví dụ |
|------|--------|
| **Thư mục** | Kéo thả cả thư mục vào |
| **Ảnh** | JPG, PNG, GIF, WebP, SVG |
| **Video** | MP4, MOV, AVI, WebM |
| **Tài liệu** | PDF, DOC, DOCX, XLS, XLSX |
| **Mọi file** | Không giới hạn định dạng |

## Chi phí

| Dịch vụ | Chi phí | Ghi chú |
|---------|---------|----------|
| Signaling Server | $0 | Tự host, dùng local cho demo |
| STUN Server | $0 | Google + Open Relay miễn phí |
| Hosting | $0 | Vercel/Netlify free tier |

**Tổng: $0**

## Roadmap

### Phase 1 (Sau Hackathon)
- [ ] Ổn định Web App, fix bugs
- [ ] Collect feedback từ user đầu tiên

### Phase 2 (3-6 tháng)
- [ ] Android/iOS App
- [ ] Subdomain branding
- [ ] Analytics dashboard

### Phase 3 (6-12 tháng)
- [ ] API for developers
- [ ] Enterprise features (SSO, audit log)

## Giấy phép

MIT License

## Đội ngũ

- **Trưởng nhóm**: Đỗ Đăng Trường
- **Thành viên**: Trần Quốc Toàn
- **Cuộc thi**: SPC Hackathon 2026
