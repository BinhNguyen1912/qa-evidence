# qa-evidence

Bằng chứng kiểm thử API, chạy **hoàn toàn trên máy bạn**. Không ghi gì vào repo
project, không push gì lên git của team.

Bạn chỉ nhập mã ticket. Tool tự tìm file case, chạy Bruno, chụp ảnh, gom kết quả
vào `~/Desktop/TRUST-XXX`, rồi (tuỳ chọn) đẩy lên đúng ticket Jira.

---

## 1. Cài trên máy mới

Cần Node 18 trở lên (`node -v` để kiểm tra).

```bash
git clone <repo-url> ~/qa-evidence
cd ~/qa-evidence
npm install
npm link
```

`npm install` tự tải Chromium (qua script `prepare`). `npm link` tạo lệnh
`qa-evidence` dùng được ở mọi thư mục.

Nếu `npm link` báo lỗi quyền (npm của Homebrew), dùng cách này:

```bash
npm config set prefix ~/.npm-global
npm link
```

Rồi thêm dòng sau vào `~/.zshrc` và mở terminal mới:

```
export PATH="$HOME/.npm-global/bin:$PATH"
```

Kiểm tra:

```bash
cd ~/trustwow-backend
qa-evidence doctor
```

Phải thấy `Bruno CLI: co` và `Chromium (playwright): co`. Nếu thiếu Chromium:

```bash
cd ~/qa-evidence && npx playwright install chromium
```

## 2. Dùng hằng ngày

### Tạo file case

```bash
cd ~/trustwow-backend
qa-evidence init TRUST-1166
```

Tạo ra `.scratch/TRUST-1166/cases.json`. Mở file, sửa nội dung case.

### Chạy

```bash
qa-evidence run TRUST-1166
```

Không cần đường dẫn. Sáng hôm sau mở terminal, chỉ cần 2 lệnh này.

Kết quả tự mở trong Finder tại `~/Desktop/TRUST-1166/`:

```
~/Desktop/TRUST-1166/
  bang-chung-20261028-101152.png     ảnh tổng hợp, mở là thấy ngay
  bang-chung-20261028-101152.html
  case-tc02-....png                  ảnh riêng từng case không đạt
  results.json                       dữ liệu thô, tc-excel đọc được
  bao-cao.md                         bản tóm tắt để dán vào comment
  runs/                              lịch sử lần chạy trước
```

### Đẩy lên Jira

```bash
qa-evidence run TRUST-1166 --attach
```

Gắn ảnh, `results.json` và `bao-cao.md` vào đúng ticket.

## 3. Viết nội dung case

```json
{
  "ticket": "TRUST-1166",
  "baseUrl": "http://localhost:3000",
  "cases": [
    {
      "id": "TC01",
      "name": "Rút tiền về Vietcombank chi nhánh Quận 1 của Nguyễn Thị Thu Hà",
      "method": "POST",
      "path": "/api/v1/mobile/wallet/withdrawals",
      "body": {
        "amount": 2500000,
        "bankCode": "VCB",
        "accountNumber": "0071000123456"
      },
      "expect": { "status": 201, "body": { "status": "PENDING" } }
    }
  ]
}
```

`expect` hỗ trợ ba khóa:

| Khóa | Ý nghĩa |
| --- | --- |
| `status` | Mã HTTP mong đợi |
| `body` | Trường phải bằng đúng giá trị này (đường dẫn dạng `a.b.c`) |
| `notBody` | Trường phải khác giá trị này |

Mặc định mọi case gửi Bearer token. Endpoint công khai thì thêm `"auth": false`.

### Token đăng nhập

Hầu hết API cần JWT, nên tool bắt buộc có token và báo lỗi rõ nếu thiếu (chứ
không để mọi case ra 401 rồi báo Fail — dễ hiểu nhầm là API hỏng):

    qa-evidence run TRUST-1166 --token "JWT-DAN-VAO-DAY"

Hoặc đặt biến môi trường, khỏi gõ lại mỗi lần:

    export QA_EVIDENCE_TOKEN="JWT-DAN-VAO-DAY"
    qa-evidence run TRUST-1166

Lấy token bằng cách đăng nhập app rồi copy từ DevTools, phần Network, header
authorization. Token chỉ nằm trong file tạm của lần chạy, xoá ngay sau đó;
không vào project, không vào results.json.

Token hết hạn thì API trả 401 và case Fail — đó là kết quả đúng, không phải lỗi tool.

### Luật dữ liệu test

Dùng **dữ liệu giả lập nhưng có hình dạng dữ liệu thật**: tên người Việt có dấu,
số điện thoại dạng `0` hoặc `+84`, tên ngân hàng Việt, số tiền VND, địa chỉ Việt.

Tool **từ chối chạy** nếu thấy placeholder như `Nguyen Van A`, `John Doe`,
`test123`, `abc`. Mỗi case nên có dữ liệu khác nhau để ảnh chụp xác định đúng
một tình huống.

Giả lập, không phải người thật: không copy PII khách hàng, giấy tờ KYC, số tài
khoản hay số điện thoại thật.

## 4. Cấu hình Jira (một lần cho mỗi máy)

```bash
qa-evidence setup-jira
```

Hỏi 3 thông tin: địa chỉ Jira, email, API token. Lưu vào
`~/.qa-evidence/secrets.json` với quyền `600`, **ngoài mọi repo** — không commit
được, không push nhầm.

Lấy API token tại: https://id.atlassian.com/manage-profile/security/api-tokens

## 5. File case nằm ở đâu

Mặc định: `.scratch/TRUST-XXX/cases.json`

Nếu đã có thư mục đặt tên kiểu cũ, tool vẫn tìm ra:

| Tên thư mục | Có nhận không |
| --- | --- |
| `.scratch/TRUST-1072/cases.json` | có (ưu tiên) |
| `.scratch/t1072/cases.json` | có |
| `.scratch/trust-1072-conformance/cases.json` | có |
| `.scratch/t705/cases.json` khi tìm TRUST-705 | có |

Nếu **nhiều thư mục cùng khớp** một mã (ví dụ `t1091` và `trust-1091-conformance`),
tool dừng lại và liệt kê chúng, không tự chọn. Nếu tự chọn, bạn sửa file này mà
lần chạy lại đọc file kia — rất khó lần ra nguyên nhân.

Tên thư mục chuẩn `.scratch/TRUST-XXX/` luôn được ưu tiên hơn tên cũ.

Không tìm thấy thì tool in ra đường dẫn cần tạo và nội dung mẫu, không đoán bừa.

## 6. Nối vào quy trình Excel sẵn có

`results.json` đã đúng định dạng `tc-excel` đang đọc:

```bash
cd ~/trustwow-backend
qa-evidence run TRUST-1166
docs/tools/testcase-excel/tc-excel --results ~/Desktop/TRUST-1166/results.json
```

Chạy `qa-evidence` trước, rồi `tc-excel`, để workbook có kết quả Pass/Fail thật
thay vì "Not run".

## 7. Mã thoát

| Mã | Nghĩa |
| --- | --- |
| `0` | Tất cả case Pass |
| `1` | Có case Fail hoặc Blocked, hoặc dữ liệu test chưa đạt |
| `2` | Sai cách dùng lệnh, hoặc chưa có file case |

`Blocked` nghĩa là Bruno không trả về kết quả cho case đó. Nó khác hẳn Pass, để
case bị bỏ qua không bao giờ trông như đã kiểm thử thành công.

## 8. Phạm vi

- Chỉ dùng local. Không bước nào ghi vào repo project.
- Không tự push, không tự tạo PR, không sửa git config.
- Chỉ đẩy file lên Jira khi bạn thêm `--attach`.
- Collection sinh trong thư mục tạm, xoá sau mỗi lần chạy (`--keep-temp` để giữ).

## 9. Phát triển tool

```bash
npm test                                    # 17 test
node --test test/cases.test.js              # riêng phần map ticket
```

Cấu trúc:

| File | Việc |
| --- | --- |
| `bin/qa-evidence.js` | CLI, các lệnh |
| `lib/cases.js` | map mã ticket sang đường dẫn file |
| `lib/bru.js` | sinh collection, chạy Bruno, đọc report |
| `lib/evidence.js` | sinh HTML báo cáo |
| `lib/shot.js` | HTML sang PNG |
| `lib/jira.js` | gắn file lên ticket |
| `lib/testdata.js` | chặn dữ liệu placeholder |
| `lib/run.js` | ghép các bước |
