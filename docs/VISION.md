# AI Household Butler — Product Vision & Technical Brief

> *We don't build a smarter home. We build smarter living together.*

## 1. Tầm nhìn

Xây dựng một **AI Household Butler**, hay một **Connected Living Platform**, giúp kết nối con người, thông tin, đồ vật và dịch vụ xoay quanh một ngôi nhà.

Vấn đề cốt lõi không phải là thiếu ứng dụng. Người dùng hiện nay có quá nhiều ứng dụng riêng biệt — email, ngân hàng, shopping, delivery, calendar, chat, recipe, wardrobe, property management… Mỗi ứng dụng chỉ biết một phần của cuộc sống.

Mục tiêu của nền tảng là kết nối những mảnh thông tin đó lại để người dùng không phải tự tìm kiếm, sao chép, kiểm tra và phối hợp mọi thứ bằng tay.

## 2. Core Concept: Home / Living Graph

Nền tảng cần có một **Knowledge Graph / Household Graph** làm lớp dữ liệu trung tâm — không chỉ lưu dữ liệu dưới dạng các bảng riêng biệt, mà phải hiểu **mối quan hệ** giữa các đối tượng.

```
Home → People → Rooms → Items → Tasks → Events → Transactions → Documents → Services → AI
```

Một vật thể có thể liên quan đồng thời đến nhiều module:

- **Milk** → Kitchen inventory → Expiry date → Recipe → Shopping list → Household budget → Receipt → Retailer → Delivery
- **Dyson** → Wishlist → Purchase → Receipt → Warranty → Delivery → Household asset → Maintenance

Graph là nền tảng để AI hiểu context, thay vì chỉ tìm kiếm từng mẩu dữ liệu độc lập.

## 3. Integration / API Layer

Ứng dụng không thay thế các dịch vụ hiện có; nó kết nối với chúng khi có API, connector hoặc quyền truy cập phù hợp.

| Nguồn | Hệ thống nhận được |
|---|---|
| Email | hóa đơn / receipt / tracking number |
| Calendar | lịch gia đình |
| Bank / Finance provider | giao dịch, household expenses |
| Retailers | product / price / shopping information |
| Delivery providers | parcel tracking |
| Smart Home platforms | device status |
| Property management systems | maintenance / tenancy information |
| Shopping services | cart / ordering |

Thay vì *Email → tìm hóa đơn → calculator → group chat → bank → calendar*:

> Information enters the platform once → system understands it → connects it to the relevant household context → creates the appropriate action.

Không phải dịch vụ nào cũng cung cấp API, vì vậy hệ thống phải được thiết kế theo từng integration và permission cụ thể.

## 4. AI Household Butler

AI là lớp hiểu context nằm trên toàn bộ hệ thống — không chỉ là chatbot. Nó phải có khả năng: **Understand, Search, Recommend, Predict, Remind, Coordinate, Automate.**

Ví dụ: *"Chúng ta có khách tối thứ Bảy."* AI kiểm tra household calendar, số khách, dietary preferences, fridge inventory, nguyên liệu sẵn có, budget, shopping list, delivery schedules — rồi đề xuất menu, nguyên liệu còn thiếu, shopping list, chi phí ước tính, phân công và timeline chuẩn bị.

Đây là **context-aware AI**, không chỉ là conversational AI.

## 5. Kitchen

Lấy cảm hứng từ các ứng dụng meal-preparation như Prepika.

- **Inventory:** fridge, freezer, pantry, ingredients, quantity, expiry
- **Recipe:** save, import, photograph, community recipes, ratings, personal preferences
- **AI Kitchen:** meal planning, recipe recommendation, *"What can I cook with what I have?"*, dietary preferences, budget-aware meals, expiry-aware suggestions
- **Shopping:** Inventory → Recipe → Missing ingredients → Shopping list → Price comparison → Purchase

Kitchen không phải một app riêng biệt — nó liên kết với Household Graph và các module khác.

## 6. Household Finance

Receipt scanning, bills (rent, electricity, water, internet), household & shared expenses, bill splitting, monthly reports, budget, saving goals.

```
Electricity bill → Household → Billing period → Amount → Due date → Responsible members → Payment status → Historical spending
```

Người dùng có thể chia sẻ **kết quả cần thiết** mà không phải chia sẻ toàn bộ dữ liệu tài chính cá nhân.

## 7. Delivery & Information Hub

Nhận diện tracking number, retailer, delivery provider, recipient, expected delivery, order, receipt.

```
Email chứa tracking number → AI nhận diện → tìm delivery provider → tạo Parcel → liên kết Order → liên kết người nhận → cập nhật trạng thái
```

Người dùng không cần nhớ "cái parcel này của hãng nào và mình mua lúc nào?"

## 8. Maintenance / Property Management

- **Người thuê:** chụp ảnh vấn đề, báo cáo, mô tả, ngày giờ.
- **Property manager:** chỉ nhìn thấy thông tin liên quan maintenance.
- Lưu: issue, photos, date, property, room, contractor, status, repair history, warranty.

Property manager **không** nhìn thấy family chat, personal wardrobe, private finance, private shopping, personal information — trừ khi người dùng chủ động chia sẻ.

## 9. Personal Wardrobe & Fashion

Mỗi item: photo, brand, category, colour, size, purchase date, price, receipt, number of wears, condition, outfit combinations.

AI: suggest outfits, hiểu personal style, track unused clothing, detect wardrobe gaps, wishlist, gợi ý theo occasion/weather. Ở cấp cộng đồng, dữ liệu được chia sẻ chủ động có thể tạo thành **Fashion Intelligence layer** (colours, silhouettes, brands, combinations, seasonal trends).

## 10. Wishlist & Shopping Intelligence

```
Dyson heater → Wishlist → Price history → Sale tracking → Product comparison → Household budget → Purchase decision
```

Thông báo: *"Giá hiện tại thấp hơn mức giá bạn lưu trước đây."* Có thể kết nối affiliate partners hoặc retailer integrations.

## 11. Household Communication

Shared space cho mỗi household: chat, chia sẻ thông tin, tasks, calendar, thảo luận mua sắm, sự kiện, phân công.

- Family → Parents / Children / Personal spaces
- Share house → Residents / Landlord / Agent

**Permission phải là một phần của core architecture**, không phải tính năng bổ sung về sau.

## 12. Community Knowledge

Household Knowledge Network: recipes, cleaning/gardening tips, organisation ideas, maintenance knowledge, product experiences, household hacks, fashion knowledge.

AI dùng dữ liệu cộng đồng **đã được cho phép** để tạo recommendations, trend detection, recipe discovery, product insights, household benchmarks — ví dụ *"Những hộ gia đình có cấu trúc tương tự thường sử dụng sản phẩm này khoảng X lần/tháng."*

Dữ liệu cá nhân phải được bảo vệ, có permission rõ ràng và được xử lý theo nguyên tắc privacy / anonymisation.

## 13. Permission Architecture

**Core entities:** User, Household, Role, Room, Item, Document, Transaction, Task, Event, Service, Integration.

**Roles:** Owner, Family Member, Tenant, Guest, Property Manager, Cleaner, Contractor, Service Provider. Mỗi role chỉ được truy cập những data cần thiết.

## 14. Long-term Platform Architecture

```
                 AI BUTLER
                     │
             CONTEXT / AI LAYER
                     │
              HOUSEHOLD GRAPH
                     │
 ┌─────────┬─────────┼─────────┬─────────┐
 │         │         │         │         │
People   Objects   Events    Finance   Tasks
 │         │         │         │         │
Chat    Kitchen   Calendar   Bills   Maintenance
Wardrobe Delivery Shopping  Budget   Property
 │         │         │         │         │
 └─────────┴─────────┼─────────┴─────────┘
                     │
              INTEGRATION LAYER
                     │
 ┌────────┬────────┬────────┬────────┬────────┐
 Email   Calendar  Banks   Retailers Delivery Smart Home
```

## 15. Core Philosophy

Không xây một ứng dụng chứa thật nhiều feature. Xây một hệ thống kết nối trong đó các feature dùng **cùng một nền tảng dữ liệu**.

- Kitchen → Shopping → Receipt → Finance → Budget
- Wardrobe → Wishlist → Product → Price → Purchase → Receipt → Wardrobe
- Order → Retailer → Receipt → Delivery → Household → Recipient

Đây chính là giá trị của Household Graph.

## 16. Product Philosophy

Người dùng không nên phải trở thành người quản trị dữ liệu của chính mình.

**Capture → Understand → Connect → Act** — thay vì *Search → Copy → Paste → Remember → Organise → Repeat.*

> Spend less time managing the complexity of everyday life, and more time living together.
