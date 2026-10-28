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
npm run setup     # tai Chromium de chup anh
npm link          # tao lenh qa-evidence dung o moi thu muc
```

Bắt buộc chạy `npm run setup`. npm đời mới chặn script cài đặt tự động, nên nếu
bỏ qua bước này tool vẫn chạy nhưng **không chụp được ảnh** (chỉ ra file HTML).

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
cd /duong/dan/den/project-cua-ban
qa-evidence doctor
```

Phải thấy `Bruno CLI: co` và `Chromium (playwright): co`. Nếu thiếu Chromium:

```bash
cd ~/qa-evidence && npm run setup
```

### Cách 2: không dùng được `npm link`

Nếu máy chặn quyền ghi global, khỏi link. Tạo một alias trỏ thẳng vào file:

```bash
echo 'alias qa-evidence="node $HOME/qa-evidence/bin/qa-evidence.js"' >> ~/.zshrc
source ~/.zshrc
```

Dùng y như cách 1. Khác biệt duy nhất: khi bạn `git pull` code mới, alias tự
dùng bản mới luôn (không cần link lại).

## 2. Dùng hằng ngày

Ba lệnh, đúng thứ tự làm việc: xem case, chạy test, đẩy lên Jira.

### Bước 1 — sinh Excel để review

```bash
qa-evidence excel TRUST-1008
```

Lần đầu chưa có file case: tool tạo `.scratch/TRUST-1008/cases.json` từ mẫu
và nói rõ. Sửa nội dung case trong đó rồi chạy lại lệnh này để bảng chính xác.

File ra ở `docs/test-excel/testcase-<branch>-<yyyymmdd>.xlsx`. Mở xem, sửa
case nếu cần.

### Bước 2 — chạy test bằng Bruno, chụp màn hình

```bash
qa-evidence run TRUST-1008
```

Kết quả tự mở trong Finder tại `~/Desktop/TRUST-1008/`:

```
~/Desktop/TRUST-1008/
  bang-chung-20261028-101152.png     ảnh tổng hợp, mở là thấy ngay
  bang-chung-20261028-101152.html
  case-tc02-....png                  ảnh riêng từng case không đạt
  results.json                       dữ liệu thô
  bao-cao.md                         bản tóm tắt để dán vào comment
  runs/                              lịch sử lần chạy trước
```

Chạy lại `qa-evidence excel TRUST-1008` lúc này thì bảng có thêm cột
Pass/Fail.

Mỗi lần chạy xoá file của lần trước trong `~/Desktop/<ticket>/` nhưng giữ
thư mục `runs/` làm lịch sử. Nhờ vậy `jira` không đẩy kèm ảnh fail cũ của lần chạy trước.

### Bước 3 — đẩy lên Jira

```bash
qa-evidence jira TRUST-1008
```

Gắn ảnh, `results.json` và `bao-cao.md` vào đúng ticket. Chỉ gắn file work
product, bỏ qua `.DS_Store` và file lạ.

Tách khỏi bước 2 để kiểm tra ảnh trước khi đẩy — đẩy rồi thì người khác trên
Jira đã thấy.

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

### Chạy collection Bruno có sẵn (không tự sinh request)

Khi team đã có collection Bruno (file JSON export từ GUI), không cần chép lại
request vào `cases.json`. Khai báo collection một lần, rồi mỗi case chỉ trỏ tới
tên request trong GUI:

```json
{
  "ticket": "TRUST-1008",
  "baseUrl": "http://localhost:3000",
  "collection": "docs/bruno/trustwow-chat-module.json",
  "cases": [
    { "id": "TC01", "name": "Danh sách hội thoại", "request": "01 List Conversations" },
    { "id": "TC02", "name": "Cập nhật nhóm", "request": "05 Update Group" }
  ]
}
```

- `collection` tính từ gốc repo. Tool đổi bundle JSON thành cây `.bru` trong thư
  mục tạm rồi chạy bằng `bru run`, nên repo không bị ghi gì.
- Assertion lấy từ chính collection (block `tests`), không sinh lại — sửa kỳ
  vọng thì sửa trong Bruno GUI rồi export lại.
- `baseUrl` và token truyền qua `--env-var`, đè lên biến trong collection, nên
  file export giữ nguyên không bị sửa.
- Tên request sai (gõ nhầm, request bị đổi tên) ra **Blocked** kèm tên đã tìm,
  không bao giờ ra Pass.
- Collection tự đăng nhập và lưu token (`bru.setEnvVar('accessToken', ...)`) thì
  không cần `--token`.
- Tool **chỉ chạy request bạn khai báo**, cộng thêm request sản xuất ra biến mà
  chúng cần. Ví dụ khai báo `05 Update Group` thì tự chạy thêm
  `04 Create Group Conversation` (đặt `groupConversationId`) và
  `01 Sign In and Store Access Token` (đặt `accessToken`) — chạy thiếu thì request
  báo 400 vì lý do không liên quan code đang test. Dòng `collection` trong báo cáo
  in rõ `4/44 request ... (+ ...)` để bạn thấy nó chạy thêm gì.
- Tên request không khớp cái nào thì tool dừng và liệt kê tên đã khai báo, không
  chạy rỗng rồi báo "tất cả pass".

Tên request ghi được ba kiểu, kiểu nào cũng đúng:

- `01 List Conversations` — tên đầy đủ như trong GUI, cách thường dùng.
- `01 Conversations/01 List Conversations` — khi hai folder có request trùng tên.
- `01-list-conversations` — gõ nhanh không dấu cách, hoặc viết tắt `01 List Con`.

Nếu một tên khớp nhiều request ở các folder khác nhau, tool **dừng và liệt kê**
các đường dẫn khớp được, không tự chọn — chọn sai thì ảnh chụp rơi vào dòng
ticket khác và trông vẫn như bằng chứng thật.

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

## 5b. Dọn worktree mà không mất file

Worktree có thư mục local riêng. `.scratch/` và `docs/` bị gitignore, nên
`git worktree remove` **xoá luôn** case và plan trong đó — git chưa từng giữ
chúng nên không khôi phục được.

Trước khi xoá, đứng trong worktree chạy:

```bash
qa-evidence collect --dry-run   # xem trước
qa-evidence collect             # copy thật
```

Tool gom ba chỗ về repo chính: `.scratch/`, `docs/plans/`, `docs/testcases/`.

Nguyên tắc an toàn:

| Tình huống | Tool làm gì |
| --- | --- |
| File chưa có ở repo chính | copy sang |
| File đã có, **nội dung giống** | bỏ qua, không báo gì |
| File đã có, **nội dung khác** | **không ghi đè**, liệt kê để bạn tự `diff` |
| Đang đứng ở repo chính | báo "không cần gom" rồi thoát |

Chạy ở repo chính không làm gì cả, nên gõ nhầm cũng không sao.

## 6. Excel: bảng test case

`qa-evidence excel` gọi `tc-excel` của repo backend, nên bảng luôn dùng đúng
tool và đúng cấu hình `docs/tools/testcase-excel/config.json` (profile 11 cột).
Không có bản sao thứ hai của logic Excel trong tool này.

Ba điểm cần biết:

- `docs/` bị gitignore, nên worktree **không có** `docs/tools/`. Tool tìm
  `tc-excel` ở repo chính và chạy ở đó, nhưng đọc case/kết quả của worktree
  qua đường dẫn tuyệt đối. Bạn không phải copy tool sang worktree.
- Tên file lấy theo nhánh của worktree đang đứng, không theo nhánh repo chính.
- `run` ghi `results.json` vào cả `~/Desktop/<ticket>/` và
  `.scratch/<ticket>/` để `tc-excel` tự tìm thấy khi chạy lại.

## 7. Mã thoát

| Mã | Nghĩa |
| --- | --- |
| `0` | Tất cả case Pass |
| `1` | Có case Fail hoặc Blocked, hoặc dữ liệu test chưa đạt |
| `2` | Sai cách dùng lệnh, hoặc chưa có file case |
| `3` | Không tìm thấy tool Excel (thiếu `docs/tools/testcase-excel/tc-excel`) |

`Blocked` nghĩa là Bruno không trả về kết quả cho case đó. Nó khác hẳn Pass, để
case bị bỏ qua không bao giờ trông như đã kiểm thử thành công.

## 8. Phạm vi

- Chỉ dùng local. Không bước nào ghi vào repo project.
- Không tự push, không tự tạo PR, không sửa git config.
- Chỉ đẩy file lên Jira khi bạn gõ `qa-evidence jira`.
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
