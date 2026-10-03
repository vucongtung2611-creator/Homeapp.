/**
 * Example content for the Library shelves, in the reader's language. Each
 * item is marked as a sample, so "Clear sample content" removes them all.
 * Dates are relative ("in N days") so the examples never look stale.
 */
export interface ShelfSample {
  collection: 'recipes' | 'wishlist' | 'shopping' | 'contacts' | 'house_rules' | 'rental';
  title: string;
  body: string;
  tags: string[];
  docType?: string;
  /** Days from today. */
  dateIn?: number;
  expiresIn?: number;
  amount?: Record<string, number>;
}

const en: ShelfSample[] = [
  {
    collection: 'recipes',
    title: 'Chicken & vegetable stir-fry (20 minutes)',
    body: 'Serves: 4\nIngredients:\n- 500 g chicken thigh, sliced\n- 1 broccoli, in small florets\n- 1 red capsicum, sliced\n- 2 cloves garlic, 1 thumb ginger\n- 3 tbsp soy sauce, 1 tbsp oyster sauce, 1 tsp sugar\n- Rice for 4\n\nSteps:\n1. Start the rice.\n2. Mix the sauces and sugar with 3 tbsp water.\n3. Fry the chicken on high heat for 5 minutes, take it out.\n4. Fry garlic and ginger 30 seconds, add the vegetables for 3 minutes.\n5. Chicken back in, pour the sauce, toss for 1 minute.\n\nTip: double it on Sunday and you have lunch for Monday.',
    tags: ['dinner', 'quick'],
  },
  {
    collection: 'wishlist',
    title: 'Things the house needs',
    body: '- A second laundry basket (the blue one is cracked)\n- Kitchen scales\n- Door stop for the back door — it slams in the wind\n- Spare phone charger for the living room\n- Plants for the balcony (basil, mint)\n\nIf you buy something on this list, cross it off and add the receipt to Bills as a shared expense.',
    tags: ['home'],
  },
  {
    collection: 'shopping',
    title: 'Weekly shop',
    body: 'Fridge\n- Milk ×2, yoghurt, eggs (12)\n- Cheese, butter\n\nPantry\n- Rice 5 kg, pasta ×2, tinned tomatoes ×4\n- Olive oil, soy sauce\n\nFruit & veg\n- Bananas, apples, onions, carrots, broccoli, salad\n\nHousehold\n- Dishwashing liquid, bin bags, toilet paper ×12\n\nAdd to the list before Saturday morning.',
    tags: ['weekly'],
  },
  {
    collection: 'contacts',
    title: 'Who to call',
    body: 'Landlord / agent: Sam Carter — 0400 000 111 (rent, lease, big repairs)\nPlumber: Fix-It Plumbing — 0400 000 222 (leaks, blocked drains)\nElectrician: Bright Sparks — 0400 000 333\nBuilding manager: 0400 000 444 (lifts, garage, common areas)\nNeighbour with the spare key: Mrs Lee, flat 2\n\nEmergencies: 000. Power outage: check the fuse box in the hallway cupboard first.',
    tags: ['important'],
  },
  {
    collection: 'house_rules',
    title: 'Our house rules',
    body: '1. Dishes are washed the same day — whoever cooks doesn’t wash up.\n2. Bins go out on Tuesday and Friday nights (see the roster in the chat).\n3. Quiet after 10:30 pm on weeknights.\n4. Overnight guests: say so in the chat the day before.\n5. Shared food is on the middle fridge shelf; anything else, ask first.\n6. Bills are split evenly; pay within 7 days of the reminder.\n7. Problems? Raise them in the chat or at the monthly house dinner.',
    tags: ['agreed'],
  },
  {
    collection: 'rental',
    title: 'Lease — 12 months',
    body: 'Signed by all tenants and the agent. Rent paid fortnightly by bank transfer. Notice to leave: 4 weeks before the end date. Keep the signed PDF attached here.',
    tags: ['lease'],
    docType: 'lease',
    dateIn: -300,
    expiresIn: 65,
    amount: { VND: 18_000_000, JPY: 180_000, KRW: 1_800_000, default: 2400 },
  },
  {
    collection: 'rental',
    title: 'Condition report at move-in',
    body: 'Room by room, with photos:\n- Living room: small scratch on the floor by the window (photo 1)\n- Kitchen: oven light not working (reported to the agent)\n- Bathroom: grout stain behind the tap (photo 2)\n- Bedroom 2: blind cord broken\n\nCopy sent to the agent on the move-in day; their reply is in the email.',
    tags: ['move-in'],
    docType: 'condition_report',
    dateIn: -300,
  },
];

const vi: ShelfSample[] = [
  {
    collection: 'recipes',
    title: 'Gà xào rau củ (20 phút)',
    body: 'Khẩu phần: 4 người\nNguyên liệu:\n- 500 g đùi gà, thái mỏng\n- 1 cây bông cải xanh, tách nhỏ\n- 1 quả ớt chuông đỏ\n- 2 tép tỏi, 1 nhánh gừng\n- 3 thìa nước tương, 1 thìa dầu hào, 1 thìa nhỏ đường\n- Cơm cho 4 người\n\nCách làm:\n1. Nấu cơm trước.\n2. Pha nước tương, dầu hào, đường với 3 thìa nước.\n3. Xào gà lửa lớn 5 phút rồi trút ra.\n4. Phi tỏi gừng 30 giây, cho rau vào xào 3 phút.\n5. Cho gà vào lại, rưới nước sốt, đảo đều 1 phút.\n\nMẹo: chủ nhật nấu gấp đôi để có cơm trưa thứ Hai.',
    tags: ['bữa tối', 'nhanh'],
  },
  {
    collection: 'wishlist',
    title: 'Đồ nhà cần mua',
    body: '- Thêm một giỏ đựng đồ giặt (giỏ xanh bị nứt)\n- Cân nhà bếp\n- Chặn cửa sau — gió hay đập cửa\n- Thêm một sạc điện thoại ở phòng khách\n- Vài chậu cây cho ban công (húng quế, bạc hà)\n\nAi mua món nào thì gạch đi và thêm hoá đơn vào mục Hoá đơn như chi tiêu chung.',
    tags: ['nhà'],
  },
  {
    collection: 'shopping',
    title: 'Đi chợ hằng tuần',
    body: 'Tủ lạnh\n- Sữa ×2, sữa chua, trứng (10 quả)\n- Đậu phụ, thịt heo 500 g\n\nĐồ khô\n- Gạo 5 kg, mì gói ×10, nước mắm, dầu ăn\n\nRau quả\n- Rau muống, cải ngọt, cà chua, hành lá, chuối, cam\n\nĐồ dùng\n- Nước rửa bát, túi rác, giấy vệ sinh ×10\n\nThêm vào danh sách trước sáng thứ Bảy.',
    tags: ['hằng tuần'],
  },
  {
    collection: 'contacts',
    title: 'Gọi ai khi cần',
    body: 'Chủ nhà: chú Hùng — 0903 000 111 (tiền nhà, hợp đồng, sửa lớn)\nThợ điện nước: anh Tâm — 0903 000 222 (rò nước, tắc cống, chập điện)\nBan quản lý toà nhà: 0903 000 333 (thang máy, gửi xe)\nHàng xóm giữ chìa khoá dự phòng: cô Lan, phòng 2\n\nKhẩn cấp: 113 (công an), 114 (cứu hoả), 115 (cấp cứu). Mất điện: kiểm tra cầu dao ở tủ hành lang trước.',
    tags: ['quan trọng'],
  },
  {
    collection: 'house_rules',
    title: 'Nội quy của nhà mình',
    body: '1. Rửa bát trong ngày — ai nấu thì người khác rửa.\n2. Đổ rác tối thứ Ba và thứ Sáu (xem lịch phân công trong chat).\n3. Sau 22:30 các ngày trong tuần giữ yên lặng.\n4. Khách ngủ lại: báo trong chat trước một ngày.\n5. Đồ ăn chung để ngăn giữa tủ lạnh; đồ khác hỏi trước khi dùng.\n6. Hoá đơn chia đều; trả trong 7 ngày kể từ khi có nhắc.\n7. Có vấn đề gì thì nói trong chat hoặc ở bữa cơm chung hằng tháng.',
    tags: ['đã thống nhất'],
  },
  {
    collection: 'rental',
    title: 'Hợp đồng thuê nhà — 12 tháng',
    body: 'Có chữ ký của tất cả người thuê và chủ nhà. Tiền nhà chuyển khoản vào ngày 5 hằng tháng. Báo trả nhà trước 30 ngày. Lưu bản PDF đã ký ở đây.',
    tags: ['hợp đồng'],
    docType: 'lease',
    dateIn: -300,
    expiresIn: 65,
    amount: { VND: 9_000_000, JPY: 90_000, KRW: 900_000, default: 1200 },
  },
  {
    collection: 'rental',
    title: 'Biên bản tình trạng nhà khi nhận',
    body: 'Từng phòng, có ảnh:\n- Phòng khách: vết xước nhỏ trên sàn cạnh cửa sổ (ảnh 1)\n- Bếp: đèn lò nướng không sáng (đã báo chủ nhà)\n- Nhà tắm: vết ố ở ron gạch sau vòi nước (ảnh 2)\n- Phòng ngủ 2: dây rèm bị đứt\n\nĐã gửi bản sao cho chủ nhà ngày nhận nhà; chủ nhà đã trả lời qua Zalo.',
    tags: ['nhận nhà'],
    docType: 'condition_report',
    dateIn: -300,
  },
];

const fr: ShelfSample[] = [
  { collection: 'recipes', title: 'Poulet sauté aux légumes (20 minutes)', body: 'Pour : 4 personnes\nIngrédients :\n- 500 g de haut de cuisse de poulet émincé\n- 1 brocoli en petits bouquets\n- 1 poivron rouge\n- 2 gousses d’ail, 1 morceau de gingembre\n- 3 c. à soupe de sauce soja, 1 de sauce d’huître, 1 c. à café de sucre\n- Du riz pour 4\n\nÉtapes :\n1. Lancez le riz.\n2. Mélangez les sauces et le sucre avec 3 c. à soupe d’eau.\n3. Saisissez le poulet 5 minutes à feu vif, réservez.\n4. Faites revenir ail et gingembre 30 secondes, puis les légumes 3 minutes.\n5. Remettez le poulet, versez la sauce, mélangez 1 minute.\n\nAstuce : doublez les quantités le dimanche pour le déjeuner du lundi.', tags: ['dîner', 'rapide'] },
  { collection: 'wishlist', title: 'Ce qu’il manque à la maison', body: '- Un deuxième panier à linge (le bleu est fendu)\n- Une balance de cuisine\n- Un cale-porte pour la porte arrière — elle claque au vent\n- Un chargeur de téléphone pour le salon\n- Des plantes pour le balcon (basilic, menthe)\n\nSi vous achetez quelque chose de la liste, rayez-le et ajoutez le reçu dans Factures comme dépense commune.', tags: ['maison'] },
  { collection: 'shopping', title: 'Courses de la semaine', body: 'Frigo\n- Lait ×2, yaourts, œufs (12)\n- Fromage, beurre\n\nPlacard\n- Riz 5 kg, pâtes ×2, tomates en boîte ×4\n- Huile d’olive, sauce soja\n\nFruits et légumes\n- Bananes, pommes, oignons, carottes, brocoli, salade\n\nMaison\n- Liquide vaisselle, sacs poubelle, papier toilette ×12\n\nAjoutez vos besoins avant samedi matin.', tags: ['semaine'] },
  { collection: 'contacts', title: 'Qui appeler', body: 'Propriétaire / agence : Sam Carter — 06 00 00 01 11 (loyer, bail, grosses réparations)\nPlombier : Plomberie Express — 06 00 00 02 22 (fuites, canalisations bouchées)\nÉlectricien : 06 00 00 03 33\nSyndic de l’immeuble : 06 00 00 04 44\nVoisine avec le double des clés : Mme Lee, appartement 2\n\nUrgences : 112. Coupure de courant : vérifiez d’abord le tableau électrique dans le placard du couloir.', tags: ['important'] },
  { collection: 'house_rules', title: 'Nos règles de la maison', body: '1. La vaisselle se fait le jour même — qui cuisine ne fait pas la vaisselle.\n2. Poubelles le mardi et le vendredi soir (voir le planning dans la discussion).\n3. Calme après 22 h 30 en semaine.\n4. Invités pour la nuit : prévenez la veille dans la discussion.\n5. La nourriture commune est sur l’étagère du milieu du frigo ; pour le reste, demandez.\n6. Les factures sont partagées à parts égales ; payez sous 7 jours.\n7. Un souci ? On en parle dans la discussion ou au dîner mensuel.', tags: ['validé'] },
  { collection: 'rental', title: 'Bail — 12 mois', body: 'Signé par tous les locataires et l’agence. Loyer payé par virement chaque mois. Préavis : 1 mois avant la date de fin. Joignez ici le PDF signé.', tags: ['bail'], docType: 'lease', dateIn: -300, expiresIn: 65, amount: { VND: 18_000_000, JPY: 180_000, KRW: 1_800_000, default: 1600 } },
  { collection: 'rental', title: 'État des lieux d’entrée', body: 'Pièce par pièce, avec photos :\n- Salon : petite rayure au sol près de la fenêtre (photo 1)\n- Cuisine : lampe du four en panne (signalée à l’agence)\n- Salle de bain : joint taché derrière le robinet (photo 2)\n- Chambre 2 : cordon du store cassé\n\nCopie envoyée à l’agence le jour de l’entrée ; leur réponse est dans les e-mails.', tags: ['entrée'], docType: 'condition_report', dateIn: -300 },
];

const de: ShelfSample[] = [
  { collection: 'recipes', title: 'Hähnchen-Gemüse-Pfanne (20 Minuten)', body: 'Portionen: 4\nZutaten:\n- 500 g Hähnchenschenkel, in Streifen\n- 1 Brokkoli in kleinen Röschen\n- 1 rote Paprika\n- 2 Knoblauchzehen, 1 Stück Ingwer\n- 3 EL Sojasauce, 1 EL Austernsauce, 1 TL Zucker\n- Reis für 4\n\nSchritte:\n1. Reis aufsetzen.\n2. Saucen und Zucker mit 3 EL Wasser verrühren.\n3. Hähnchen 5 Minuten scharf anbraten, herausnehmen.\n4. Knoblauch und Ingwer 30 Sekunden, dann Gemüse 3 Minuten braten.\n5. Hähnchen zurück, Sauce dazu, 1 Minute schwenken.\n\nTipp: sonntags doppelt kochen, dann ist das Mittagessen für Montag schon fertig.', tags: ['Abendessen', 'schnell'] },
  { collection: 'wishlist', title: 'Was der Haushalt braucht', body: '- Einen zweiten Wäschekorb (der blaue ist gerissen)\n- Eine Küchenwaage\n- Einen Türstopper für die Hintertür — sie knallt bei Wind\n- Ein Handy-Ladekabel fürs Wohnzimmer\n- Pflanzen für den Balkon (Basilikum, Minze)\n\nWer etwas von der Liste kauft: abhaken und den Beleg unter Rechnungen als gemeinsame Ausgabe eintragen.', tags: ['Zuhause'] },
  { collection: 'shopping', title: 'Wocheneinkauf', body: 'Kühlschrank\n- Milch ×2, Joghurt, Eier (10)\n- Käse, Butter\n\nVorrat\n- Reis 5 kg, Nudeln ×2, Dosentomaten ×4\n- Olivenöl, Sojasauce\n\nObst & Gemüse\n- Bananen, Äpfel, Zwiebeln, Karotten, Brokkoli, Salat\n\nHaushalt\n- Spülmittel, Müllbeutel, Toilettenpapier ×12\n\nBitte bis Samstagmorgen ergänzen.', tags: ['wöchentlich'] },
  { collection: 'contacts', title: 'Wen anrufen', body: 'Vermieter / Hausverwaltung: Sam Carter — 0151 000 0111 (Miete, Vertrag, große Reparaturen)\nKlempner: Rohr-Blitz — 0151 000 0222 (Lecks, verstopfte Abflüsse)\nElektriker: 0151 000 0333\nHausmeister: 0151 000 0444 (Aufzug, Keller, Treppenhaus)\nNachbarin mit dem Ersatzschlüssel: Frau Lee, Wohnung 2\n\nNotruf: 112. Stromausfall: zuerst den Sicherungskasten im Flurschrank prüfen.', tags: ['wichtig'] },
  { collection: 'house_rules', title: 'Unsere Hausregeln', body: '1. Abwasch am selben Tag — wer kocht, spült nicht.\n2. Müll dienstags und freitags abends raus (Plan steht im Chat).\n3. Unter der Woche ab 22:30 Ruhe.\n4. Übernachtungsgäste: am Vortag im Chat Bescheid sagen.\n5. Gemeinsames Essen steht im mittleren Kühlschrankfach; alles andere erst fragen.\n6. Rechnungen werden gleich geteilt; innerhalb von 7 Tagen zahlen.\n7. Probleme? Im Chat oder beim monatlichen WG-Essen ansprechen.', tags: ['vereinbart'] },
  { collection: 'rental', title: 'Mietvertrag — 12 Monate', body: 'Von allen Mieter:innen und der Verwaltung unterschrieben. Miete monatlich per Überweisung. Kündigungsfrist: 3 Monate. Das unterschriebene PDF hier anhängen.', tags: ['Vertrag'], docType: 'lease', dateIn: -300, expiresIn: 65, amount: { VND: 18_000_000, JPY: 180_000, KRW: 1_800_000, default: 1800 } },
  { collection: 'rental', title: 'Übergabeprotokoll beim Einzug', body: 'Raum für Raum, mit Fotos:\n- Wohnzimmer: kleiner Kratzer im Boden am Fenster (Foto 1)\n- Küche: Backofenlampe defekt (der Verwaltung gemeldet)\n- Bad: verfärbte Fuge hinter dem Wasserhahn (Foto 2)\n- Zimmer 2: Rollo-Schnur gerissen\n\nKopie am Einzugstag an die Verwaltung geschickt; die Antwort steht in den E-Mails.', tags: ['Einzug'], docType: 'condition_report', dateIn: -300 },
];

const nl: ShelfSample[] = [
  { collection: 'recipes', title: 'Roerbak met kip en groenten (20 minuten)', body: 'Personen: 4\nIngrediënten:\n- 500 g kippendij, in reepjes\n- 1 broccoli in kleine roosjes\n- 1 rode paprika\n- 2 tenen knoflook, 1 stukje gember\n- 3 el sojasaus, 1 el oestersaus, 1 tl suiker\n- Rijst voor 4\n\nStappen:\n1. Zet de rijst op.\n2. Meng de sauzen en suiker met 3 el water.\n3. Bak de kip 5 minuten op hoog vuur, haal eruit.\n4. Bak knoflook en gember 30 seconden, dan de groenten 3 minuten.\n5. Kip terug, saus erbij, 1 minuut omscheppen.\n\nTip: maak op zondag een dubbele portie, dan heb je lunch voor maandag.', tags: ['avondeten', 'snel'] },
  { collection: 'wishlist', title: 'Wat het huis nodig heeft', body: '- Een tweede wasmand (de blauwe is gescheurd)\n- Een keukenweegschaal\n- Een deurstopper voor de achterdeur — die slaat dicht bij wind\n- Een telefoonlader voor de woonkamer\n- Planten voor het balkon (basilicum, munt)\n\nKoop je iets van de lijst? Streep het door en zet de bon bij Rekeningen als gedeelde uitgave.', tags: ['huis'] },
  { collection: 'shopping', title: 'Weekboodschappen', body: 'Koelkast\n- Melk ×2, yoghurt, eieren (10)\n- Kaas, boter\n\nVoorraad\n- Rijst 5 kg, pasta ×2, tomaten in blik ×4\n- Olijfolie, sojasaus\n\nGroente & fruit\n- Bananen, appels, uien, wortels, broccoli, sla\n\nHuishouden\n- Afwasmiddel, vuilniszakken, wc-papier ×12\n\nVul de lijst aan vóór zaterdagochtend.', tags: ['wekelijks'] },
  { collection: 'contacts', title: 'Wie bel je', body: 'Verhuurder / makelaar: Sam Carter — 06 0000 0111 (huur, contract, grote reparaties)\nLoodgieter: Snel Loodgieters — 06 0000 0222 (lekkages, verstopte afvoer)\nElektricien: 06 0000 0333\nBeheerder van het gebouw: 06 0000 0444 (lift, garage, trappenhuis)\nBuurvrouw met de reservesleutel: mevrouw Lee, nummer 2\n\nNoodnummer: 112. Stroom uitgevallen: kijk eerst in de meterkast in de gang.', tags: ['belangrijk'] },
  { collection: 'house_rules', title: 'Onze huisregels', body: '1. Afwas dezelfde dag — wie kookt, wast niet af.\n2. Vuilnis dinsdag- en vrijdagavond buiten (rooster staat in de chat).\n3. Doordeweeks stil na 22.30 uur.\n4. Logees: meld het de dag ervoor in de chat.\n5. Gedeeld eten staat op de middelste plank van de koelkast; de rest eerst vragen.\n6. Rekeningen delen we gelijk; betaal binnen 7 dagen.\n7. Iets dwarszitten? Zeg het in de chat of bij het maandelijkse huisetentje.', tags: ['afgesproken'] },
  { collection: 'rental', title: 'Huurcontract — 12 maanden', body: 'Ondertekend door alle huurders en de makelaar. Huur maandelijks per overboeking. Opzegtermijn: 1 maand vóór de einddatum. Hang de getekende pdf hier aan.', tags: ['contract'], docType: 'lease', dateIn: -300, expiresIn: 65, amount: { VND: 18_000_000, JPY: 180_000, KRW: 1_800_000, default: 1500 } },
  { collection: 'rental', title: 'Opleveringsrapport bij intrek', body: 'Kamer voor kamer, met foto’s:\n- Woonkamer: klein krasje in de vloer bij het raam (foto 1)\n- Keuken: ovenlampje werkt niet (gemeld bij de makelaar)\n- Badkamer: verkleurde voeg achter de kraan (foto 2)\n- Slaapkamer 2: koord van de rolgordijn kapot\n\nKopie op de intrekdag naar de makelaar gestuurd; hun antwoord staat in de mail.', tags: ['intrek'], docType: 'condition_report', dateIn: -300 },
];

const BY_LOCALE: Record<string, ShelfSample[]> = { en, vi, fr, de, nl };

export function shelfSamples(locale: string): ShelfSample[] {
  return BY_LOCALE[locale.slice(0, 2).toLowerCase()] ?? en;
}
