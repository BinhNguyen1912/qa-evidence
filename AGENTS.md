# qa-evidence — hướng dẫn cho agent

Tool chạy **trên máy local**, sinh bằng chứng kiểm thử API cho một ticket. Không ghi vào
git của project, không push gì lên repo của team.

Đọc file này rồi tự setup. Không cần hỏi lại user từng bước.

---

## 0. Trước khi làm gì: xác định đang ở đâu

Agent phải phân biệt hai thứ khác nhau:

- **Tool repo** = nơi code của chính qa-evidence sống. Thường `~/qa-evidence`.
- **Project repo** = repo đang được test. Là git repo hiện tại khi bạn `cd` vào.

Phần A cài tool. Phần B chạy trong project. Không lẫn hai phần.

Kiểm tra nhanh:

```bash
node -v                                  # phải >= 18
ls ~/qa-evidence/bin/qa-evidence.js      # tool đã có chưa
git rev-parse --show-toplevel            # project repo hiện tại
```

**Xong khi:** biết `node -v` đạt >= 18 và biết đường dẫn tuyệt đối của cả hai repo.

---

## Phần A — Cài tool (một lần mỗi máy)

Chỉ làm phần này khi `ls ~/qa-evidence/bin/qa-evidence.js` không tồn tại.

| # | Lệnh | Sinh ra |
| --- | --- | --- |
| A1 | `git clone https://github.com/BinhNguyen1912/qa-evidence.git ~/qa-evidence` | Thư mục `~/qa-evidence/` |
| A2 | `cd ~/qa-evidence && npm install` | `node_modules/` (~279 MB): `@usebruno/cli`, `playwright` |
| A3 | `npm run setup` | Cache Chromium của Playwright. **Bắt buộc** — thiếu thì không chụp được ảnh, chỉ ra HTML |
| A4 | `npm link` | Lệnh `qa-evidence` dùng được ở mọi thư mục |

Nếu A4 lỗi quyền (npm của Homebrew):

```bash
npm config set prefix ~/.npm-global && npm link
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

Hoặc bỏ A4, thay bằng alias — chạy `git pull` là dùng bản mới luôn:

```bash
echo 'alias qa-evidence="node $HOME/qa-evidence/bin/qa-evidence.js"' >> ~/.zshrc
source ~/.zshrc
```

**Xong khi:** `qa-evidence --help` (hoặc `node ~/qa-evidence/bin/qa-evidence.js --help`)
in ra được danh sách lệnh.

---

## Phần B — Setup trong project repo

Vào **project repo**, không cần cấu hình gì. Tool tự nhận project qua `git rev-parse`.

| # | Lệnh | Sinh ra |
| --- | --- | --- |
| B1 | `qa-evidence doctor` | Chỉ in màn hình, **không ghi file**. Kiểm tra Node, Bruno CLI, Chromium, `docs/bruno/`, `tc-excel`, Desktop path |
| B2 | `qa-evidence setup-jira` | `~/.qa-evidence/config.json` (URL Jira, email, API token). Ngoài repo. Chỉ làm khi cần đẩy Jira |

**Xong khi:** `doctor` in `Bruno CLI: co` và `Chromium (playwright): co`.

Hai dòng sau trong `doctor` là **bình thường**, không phải lỗi cần sửa:

- `tc-excel cua project: khong` — repo chưa có `docs/tools/testcase-excel/`. Khi đó lệnh
  `excel` không chạy được; `run` và `jira` vẫn chạy.
- `Thu muc docs/bruno: khong` — chưa khai báo collection Bruno.

---

## Phần C — Chạy cho một ticket

Thứ tự bắt buộc: `init` → sửa `cases.json` → `excel` → `run` → `excel` lại → `jira`.

| # | Lệnh | Sinh ra |
| --- | --- | --- |
| C1 | `qa-evidence init TRUST-XXXX` | `.scratch/TRUST-XXXX/cases.json` là **file mẫu**, phải sửa tay |
| C2 | sửa `.scratch/TRUST-XXXX/cases.json` | — (xem mục "cases.json" bên dưới) |
| C3 | `qa-evidence excel TRUST-XXXX` | `docs/test-excel/testcase-<branch>-<yyyymmdd>.xlsx`. Có file cùng ngày thì bản cũ đổi tên thành `...backup-<yyyymmdd-HHmmss>.xlsx` |
| C4 | `qa-evidence run TRUST-XXXX --base-url http://localhost:3000 --token <jwt>` | **Ba nơi:** ① `~/Desktop/TRUST-XXXX/`: `results.json`, `bang-chung-<ts>.html`, `bang-chung-<ts>.png`; ② `.scratch/TRUST-XXXX/results.json`; ③ temp `/tmp/qa-evidence/` (xoá được) |
| C5 | `qa-evidence excel TRUST-XXXX` (lần 2) | Cùng file xlsx, giờ cột **Kết quả chạy** hiện Pass/Fail thật vì đã có `results.json` |
| C6 | `qa-evidence jira TRUST-XXXX --attach` | Comment + đính kèm file lên ticket Jira. Đọc `results.json` của C4 |

Token: dùng `--token <jwt>` hoặc `export QA_EVIDENCE_TOKEN=<jwt>`. Case nào không cần
đăng nhập thì thêm `"auth": false` vào case đó.

**Xong khi:** `~/Desktop/TRUST-XXXX/` có `.png` và `results.json`; file xlsx có cột
`Kết quả chạy` khác `Not run`.

---

## cases.json — định dạng

Đường dẫn chuẩn: `.scratch/<TICKET>/cases.json`. Tool tìm theo thứ tự:

1. `.scratch/<TICKET>/cases.json` ← dùng cái này
2. `.scratch/<bất kỳ thư mục chứa số ticket>/cases.json`
3. `.qa-evidence/<TICKET>/cases.json`

Nếu **hai** thư mục cùng khớp ticket (`t1166`, `trust-1166-old`), tool **dừng** và liệt kê
cả hai thay vì tự chọn. Giữ đúng một thư mục tên chuẩn `.scratch/TRUST-1166/`.

```json
{
  "ticket": "TRUST-1166",
  "profile": "finance",
  "baseUrl": "http://localhost:3000",
  "collection": "docs/bruno/ten-module.json",
  "cases": [
    {
      "id": "TC01",
      "name": "Tên kịch bản",
      "type": "Happy",
      "endpoint": "/api/v1/web/admin/...",
      "method": "POST",
      "precondition": "Điều kiện trước",
      "input": "{ \"period\": \"2026-09\" }",
      "expected": "200 ...",
      "journals": "Dr ... / Cr ...",
      "severity": "High",
      "note": "",
      "request": "01 Ten Request Trong Bruno"
    }
  ]
}
```

- `profile`: `api` | `finance` (có cột bút toán Nợ/Có) | `ui`
- `request`: **bắt buộc khi chạy Bruno**. Phải khớp chính xác tên request trong collection.
  Sai tên → tool dừng và liệt kê các tên đã khai báo; đọc danh sách đó để sửa, đừng đoán.
- `type` để phân loại: `Happy` (luồng chính) hoặc `Edge` (biên).
- `.scratch/` phải nằm trong `.gitignore` của project.

**Xong khi:** `node -e 'require("./.scratch/TRUST-XXXX/cases.json")'` không lỗi.

---

## Bruno collection

Tool đọc được **bundle JSON export từ Bruno GUI**, không cần chuyển sang `.bru`.

Việc này agent **không tự làm được** — phải có người export. Khi thiếu collection:

1. Báo user: mở Bruno GUI → chọn collection → Export → lưu vào `docs/bruno/<ten>.json`
   trong project repo.
2. Sau đó khai `"collection": "docs/bruno/<ten>.json"` trong `cases.json`.

---

## Worktree (quan trọng)

`docs/` và `.scratch/` thường **bị gitignore**, nên worktree mới **không có** chúng.

- Tool tự tìm main checkout qua `git rev-parse --git-common-dir` (`lib/collect.js:30`), rồi
  chạy tool Excel ở main checkout nhưng đọc `.scratch` của worktree hiện tại.
- **Không gõ trực tiếp `tc-excel` trong worktree** — sẽ báo không tìm thấy tool. Dùng
  `qa-evidence excel` để nó tự xử lý.
- `.scratch/<TICKET>/cases.json` viết ở worktree nào thì chỉ worktree đó thấy.

---

## Ba điều không được làm

1. **Không thêm script vào `package.json` của project.** Tool là local-only, ngoài repo.
2. **Không commit** `.scratch/`, `docs/test-excel/`, `~/.qa-evidence/config.json`. Chứa token
   và dữ liệu chạy thật.
3. **Không sửa code trong tool repo** khi đang setup. Setup chỉ ở phần A và B.

---

## Tự kiểm tra toàn bộ (chạy một lần)

```bash
cd ~/qa-evidence && npm test        # bộ test của tool
cd <project-repo> && qa-evidence doctor
```

**Xong khi:** `npm test` báo fail = 0, và `doctor` có Bruno CLI + Chromium.
