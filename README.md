# FileBridge - Nền tảng chuyển file P2P bảo mật

**FileBridge** là nền tảng chuyển file peer-to-peer (P2P) với mã hóa đầu cuối (E2E encryption), cho phép người dùng chia sẻ file trực tiếp giữa các thiết bị qua trình duyệt web mà không cần upload lên cloud server trung gian.

## Tính năng chính

- **P2P Direct Transfer**: File truyền trực tiếp device-to-device qua WebRTC DataChannel
- **E2E Encryption**: Mã hóa AES-256-GCM với ECDH key exchange
- **Cross-Network**: Hỗ trợ truyền qua Internet toàn cầu, không chỉ cùng mạng LAN
- **Anonymous Mode**: Không cần đăng ký, chỉ cần tạo/join phòng bằng mã 6 ký tự
- **Web App PWA**: Chạy trên trình duyệt, responsive, hoạt động offline
- **Drag & Drop**: Giao diện kéo thả file với progress bar real-time

## Kiến trúc

```
┌─────────────────────────────────────────────────────────────┐
│                    FileBridge Architecture                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  🔒 MÁY GỬI (Sender)          🔓 MÁY NHẬN (Receiver)      │
│  ┌─────────────────┐        ┌─────────────────┐         │
│  │ 1. Chọn file    │        │ 1. Tham gia phòng│         │
│  │ 2. Mã hóa       │ ───▶  │ 2. Chờ nhận     │         │
│  │    AES-256-GCM  │  P2P   │ 3. Giải mã       │         │
│  │ 3. Truyền qua   │ WebRTC │ 4. Lưu file      │         │
│  │    DataChannel  │        │                  │         │
│  └─────────────────┘        └─────────────────┘         │
│                                                             │
│              Signaling Server (chỉ relay metadata)          │
│              - SDP offer/answer                             │
│              - ICE candidates                               │
│              - KHÔNG chạm vào nội dung file                │
└─────────────────────────────────────────────────────────────┘
```

## Công nghệ sử dụng

### Frontend
- **React 18** + TypeScript + Vite
- **Tailwind CSS** cho styling
- **PeerJS** cho WebRTC
- **Zustand** cho state management
- **Web Crypto API** cho E2E encryption

### Backend (Signaling Server)
- **Node.js** + Express + Socket.IO
- **STUN Server**: Google STUN (miễn phí)

## Cài đặt

### Yêu cầu
- Node.js 18+
- npm hoặc yarn

### Clone và cài đặt

```bash
# Clone repository
git clone <repo-url>
cd filebridge-mvp

# Cài đặt dependencies cho frontend
npm install

# Cài đặt dependencies cho signaling server
cd server
npm install
cd ..
```

### Chạy ứng dụng

```bash
# Terminal 1: Chạy signaling server
cd server
npm start

# Terminal 2: Chạy frontend
npm run dev
```

Truy cập http://localhost:3000

## Sử dụng

### Tạo phòng mới (Người gửi)
1. Nhấn "Tạo phòng mới"
2. Copy mã phòng 6 ký tự
3. Chia sẻ mã cho người nhận
4. Kéo thả file vào khung để gửi

### Tham gia phòng (Người nhận)
1. Nhấn "Tham gia phòng"
2. Nhập mã phòng 6 ký tự
3. File sẽ được nhận tự động khi người gửi gửi

## Bảo mật

- **AES-256-GCM**: Mã hóa nội dung file
- **ECDH Key Exchange**: Trao đổi khóa an toàn
- **Perfect Forward Secrecy**: Mỗi phiên dùng ephemeral key khác nhau
- **HMAC-SHA256**: Kiểm tra toàn vẹn dữ liệu
- **Không lưu trữ file**: File chỉ tồn tại trên 2 thiết bị

## Demo cho Hackathon

Để demo trên sân khấu (không cần Internet):

1. Máy presenter chạy web app
2. Giám khảo + khán giả truy cập cùng WiFi
3. Trong cùng LAN, WebRTC P2P hoạt động 100%
4. Không cần STUN/TURN server

## Roadmap

### Phase 1 (Sau Hackathon)
- [ ] Ổn định Web App, fix bugs
- [ ] Collect feedback từ 100-500 user đầu tiên

### Phase 2 (3-6 tháng)
- [ ] Android App
- [ ] iOS App
- [ ] Subdomain branding cho Pro user
- [ ] Analytics dashboard

### Phase 3 (6-12 tháng)
- [ ] API for developers
- [ ] Enterprise features (SSO, audit log)
- [ ] White-label solution

## Giấy phép

MIT License

## Đội ngũ

- **Trưởng nhóm**: Đỗ Đăng Trường
- **Thành viên**: Trần Quốc Toàn
- **Cuộc thi**: SPC Hackathon 2026
