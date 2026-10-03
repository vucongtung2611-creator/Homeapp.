import { Client, DEMO_PASSWORD, leasePdf, meterPng, pizzaPng, type Fetcher } from './demo.js';

/**
 * "Williams House": a lived-in family home for filming and sharing.
 * Three people (Tom Williams, James, Ella), each with a private calendar,
 * personal Library (contacts, qualifications, books), plus a shared calendar,
 * chores, Library and chat. Everything is fictional demo data and goes
 * through the public HTTP API, like the app itself would.
 */
interface P { key: 'tom' | 'james' | 'ella'; name: string; avatar: string; role?: 'manager' | 'family_member' }
const PEOPLE: P[] = [
  { key: 'tom', name: 'Tom Williams', avatar: 'tom' },
  { key: 'james', name: 'James', avatar: 'james', role: 'manager' },
  { key: 'ella', name: 'Ella', avatar: 'ella', role: 'family_member' },
];
type Who = P['key'];

// [who, date, time, endTime, title, tag, note]  (private to the person)
const PERSONAL: [Who, string, string | null, string | null, string, string, string][] = [
  ['tom', '2026-10-05', '09:00', '10:00', '🧑‍💻 MATE build check in', 'work', 'Weekly look at what is real and what is a prototype.'],
  ['tom', '2026-10-07', '14:00', '15:00', '👥 Meet the hotel chef (Hanoi, demo)', 'meeting', 'Bring the CV.'],
  ['tom', '2026-10-10', '10:00', '11:00', '📚 English practice for the new PTE test', 'study', 'Speaking and writing drills.'],
  ['tom', '2026-10-16', '09:00', null, '📚 Return library book', 'study', 'Python crash course is due.'],
  ['tom', '2026-10-17', null, null, '🧪 PTE score expires, book a new test', 'deadline', 'Old score is valid until today.'],
  ['tom', '2026-11-02', '20:00', '21:30', '✍️ Academy application writing session', 'work', 'Draft the story and the proof of work.'],
  ['tom', '2026-11-04', '20:00', '21:00', '🎥 Record the short video', 'work', 'Show the app: house, chat, calendar, library.'],
  ['tom', '2026-11-05', null, null, '⏰ Academy early deadline', 'deadline', 'Submit before the end of the day.'],
  ['tom', '2026-11-15', null, null, '⏰ Fontys ICT February intake deadline', 'deadline', 'Switch to September if February is too tight.'],
  ['james', '2026-10-05', '10:00', '10:30', '📞 Call the shipping company', 'moving', 'Ask for the storage survey date.'],
  ['james', '2026-10-09', '15:00', '16:00', '🦷 Dentist', 'health', ''],
  ['james', '2026-10-24', '11:00', '12:00', '🚲 Photograph the bicycle for the listing', 'moving', 'Three clear photos, side and front.'],
  ['ella', '2026-10-08', '17:00', '18:00', '🎓 Visite virtuelle du campus', 'study', 'Lien dans le mail de l’école.'],
  ['ella', '2026-10-10', '10:00', '11:00', '🇳🇱 Cours de néerlandais en ligne', 'study', 'Niveau A1.'],
  ['ella', '2026-11-02', '16:00', '17:00', '👥 Rendez-vous avec la conseillère', 'meeting', 'Préparer les questions.'],
  ['ella', '2026-11-08', '18:00', '19:00', '✍️ Relire la lettre de motivation', 'study', ''],
];

// Shared by the whole house: [date, time, endTime, title, tag, note, people]
const SHARED: [string, string | null, string | null, string, string, string, Who[]][] = [
  ['2026-10-05', '19:00', '21:00', '🍽️ Family dinner, Tom cooks', 'food', 'Menu: lemongrass chicken, rice, herb salad.', ['tom', 'james', 'ella']],
  ['2026-10-14', '18:00', '19:00', '📦 Inventory check, boxes 1 to 12', 'moving', 'James reads the list, Ella ticks.', ['james', 'ella']],
  ['2026-10-17', '19:00', '22:00', '🎉 Housewarming dinner for the Hanoi home', 'food', 'Everyone brings one dish.', ['tom', 'james', 'ella']],
  ['2026-10-21', '18:00', '19:00', '📦 Inventory check, boxes 13 to 24', 'moving', '', ['james', 'ella']],
  ['2026-10-28', '18:00', '19:00', '📦 Inventory check, boxes 25 to 36', 'moving', '', ['james', 'ella']],
  ['2026-10-30', null, null, '📦 Bicycle and bed listing goes live', 'moving', 'Price them fairly, sell fast.', ['james']],
  ['2026-11-02', '19:00', '20:00', '👥 House meeting: deadlines, chores, moving plan', 'meeting', 'Agenda in the Library.', ['tom', 'james', 'ella']],
  ['2026-11-14', '18:00', '21:00', '🍰 Study break dinner before the Fontys deadline', 'food', '', ['tom', 'james', 'ella']],
];

// [title, assignees, repeatDays, due, doneBy]
const CHORES: [string, Who[], number | null, string, Who | null][] = [
  ['🗑️ Bins out (Sunday night)', ['tom', 'james', 'ella'], 7, '2026-10-04', null],
  ['🍳 House dinner (cook rotates)', ['tom', 'ella', 'james'], 7, '2026-10-07', null],
  ['🛒 Grocery run: rice, eggs, herbs, olive oil, coffee', ['ella', 'tom'], 7, '2026-10-03', 'ella'],
  ['🧹 Clean the common areas', ['james', 'tom', 'ella'], 14, '2026-10-10', null],
  ['📦 Photograph items for the listing', ['james'], null, '2026-10-24', null],
  ['📚 Return library book', ['tom'], null, '2026-10-16', null],
];

type Msg = [Who, string, string?]; // [from, text, sticker]
const GROUP: Msg[] = [
  ['tom', 'Good morning everyone. Today is Saturday 3 Oct 2026. What is the date for you two? 🙂'],
  ['james', 'Saturday here too. Bins are due Sunday night, I will remind everyone.'],
  ['ella', 'Bonjour tout le monde. Nous sommes samedi 3 octobre. Je prépare ma lettre de motivation aujourd’hui.'],
  ['tom', 'Nice. Good luck with it, Ella.', 'ok'],
  ['james', 'Tom, how is the Academy application going? Where are you at?'],
  ['tom', 'The web app is live: accounts, houses, mailbox and library work. Now I am adding calendars and chat. Next is a short video and the application text.'],
  ['james', 'Do you need help with anything from my side?'],
  ['tom', 'Yes, please test the app on your phone and tell me what feels slow.'],
  ['james', 'Will do tonight.', 'ok'],
  ['ella', 'Tom, tu as pensé aux études en informatique aux Pays-Bas ? Plusieurs écoles proposent un cursus en anglais.'],
  ['tom', 'I looked at three: Fontys in Eindhoven, BUas in Breda and Inholland in Haarlem. Fontys and BUas already have my application.'],
  ['ella', 'Super. Les dates limites comptent : Fontys, rentrée de février, c’est le 15 novembre. Pour septembre, le 1er mai.'],
  ['tom', 'Yes. I asked Fontys if they can check my documents by email first.'],
  ['ella', 'Bonne idée. Si février est trop juste, tu peux passer à septembre.'],
  ['tom', 'That is the plan. If February is too tight, I switch to September.'],
  ['james', 'Meanwhile I am sorting what is still in Australia. Box checks on 14, 21 and 28 Oct.'],
  ['james', 'Question for the group: keep the bed or sell it?'],
  ['ella', 'Si le lit est ancien, je le vendrais. Ça simplifie le transport.'],
  ['tom', 'Agreed. Sell the bed and the bicycle, ship the boxes.'],
  ['james', 'Done. I will list them on 30 Oct.', 'party'],
  ['ella', 'Merci James !', 'thanks'],
  ['tom', 'Thanks everyone. This is exactly why I am building MATE. 🏠'],
];
const DMS: Record<string, Msg[]> = {
  'tom:james': [
    ['james', 'Storage survey date is still not confirmed. I will chase on Monday.'],
    ['tom', 'Thanks. Please send me the inventory when it is ready.'],
    ['james', 'Will upload it to the house documents.', 'ok'],
  ],
  'tom:ella': [
    ['ella', 'Tu veux relire ma lettre de motivation ce soir ?'],
    ['tom', 'Yes. Send it and I will give feedback in English, you can answer in French.'],
    ['ella', 'Parfait, je te l’envoie après le dîner.', 'love'],
  ],
  'james:ella': [
    ['ella', 'James, tu peux m’aider à comprendre la liste des boîtes ?'],
    ['james', 'Sure. I will walk you through it on Wednesday.', 'ok'],
  ],
};
const WITH_MATE = ['What is on my calendar this month?', 'Remind me about the Academy deadline.'];

export async function seedFamily(base: string, fetcher: Fetcher = fetch) {
  const people = new Map<Who, { p: P; client: Client; id: string; email: string }>();
  for (const p of PEOPLE) {
    const client = new Client(base, fetcher);
    const email = `${p.key}@williams.demo`;
    const { user } = await client.call('POST', '/api/auth/signup', { email, password: DEMO_PASSWORD, name: p.name, avatar: p.avatar });
    people.set(p.key, { p, client, id: user.id, email });
  }
  const A = (k: Who) => people.get(k)!;
  const tom = A('tom');
  const { id: hid } = await tom.client.call('POST', '/api/households', { name: 'Williams House', currency: 'EUR', kind: 'family', samples: false });
  for (const k of ['james', 'ella'] as const) {
    const { url } = await tom.client.call('POST', `/api/households/${hid}/invites`, { label: A(k).p.name });
    await A(k).client.call('POST', `/api/invites/${String(url).split('/join/')[1]}/accept`, {});
    const { requests } = await tom.client.call('GET', `/api/households/${hid}/requests`);
    await tom.client.call('POST', `/api/households/${hid}/requests/${requests[0].id}/approve`, {});
    if (A(k).p.role) await tom.client.call('PATCH', `/api/households/${hid}/members/${A(k).id}`, { role: A(k).p.role });
  }

  const ids = (keys: Who[]) => keys.map((k) => A(k).id);
  // Calendars
  for (const [who, date, time, endTime, title, tag, note] of PERSONAL)
    await A(who).client.call('POST', `/api/households/${hid}/calendar`, { title, date, time, endTime, tag, note, visibility: 'me', people: ids([who]) });
  for (const [date, time, endTime, title, tag, note, who] of SHARED)
    await tom.client.call('POST', `/api/households/${hid}/calendar`, { title, date, time, endTime, tag, note, visibility: 'home', people: ids(who) });

  // Chores
  for (const [title, who, repeatDays, due, doneBy] of CHORES) {
    const chore = await A(who[0]!).client.call<{ id: string }>('POST', `/api/households/${hid}/chores`, { title, assignees: ids(who), repeatDays, due });
    if (doneBy) await A(doneBy).client.call('POST', `/api/households/${hid}/chores/${chore.id}/done`, { today: '2026-10-03' });
  }

  // Shared Library
  const upload = (k: Who, bytes: Uint8Array, name: string) => A(k).client.call<{ id: string }>('POST', `/api/households/${hid}/files`, undefined, { bytes, name });
  const item = (k: Who, data: Record<string, unknown>) => A(k).client.call('POST', `/api/households/${hid}/items`, data);
  await item('tom', { kind: 'note', title: 'House rules', body: '1. Bins out Sunday night.\n2. Shared groceries list lives in the Library.\n3. Quiet hours after 10 pm.\n4. Cook one dinner a week, the rota is in Chores.', collection: 'house_rules', tags: ['house'] });
  await item('james', { kind: 'note', title: 'Wi‑Fi and utilities (demo)', body: 'Network: WilliamsHouse\nPassword: demo-only-2026\nRouter on the living room shelf.', tags: ['wifi', 'house'] });
  await item('ella', { kind: 'note', title: 'Emergency contacts (demo)', body: 'Landlord: 0900 000 111\nElectrician: 0900 000 222\nNeighbour: 0900 000 333', collection: 'contacts', tags: ['contacts'] });
  await item('tom', { kind: 'note', title: 'Documents checklist', body: '- Passport\n- Diploma and transcripts\n- Motivation letter\n- English test result\n- Portfolio link', tags: ['study'] });
  await item('james', { kind: 'note', title: 'Moving box list (36 boxes)', body: 'Boxes 1 to 12: kitchen and books\nBoxes 13 to 24: clothes and art\nBoxes 25 to 36: electronics and misc', tags: ['moving'] });
  await item('ella', { kind: 'note', title: 'Shopping list', body: 'Rice, eggs, herbs, olive oil, coffee, lemons', collection: 'shopping', tags: ['food'] });
  await item('tom', { kind: 'note', title: 'Lemongrass chicken', body: 'Serves: 4\nIngredients:\n- 600 g chicken thigh\n- 3 stalks lemongrass\n- Garlic, fish sauce, sugar\n\nSteps:\n1. Marinate 30 min.\n2. Pan fry until golden, serve with rice and herbs.', collection: 'recipes', tags: ['dinner'] });
  const lease = await upload('tom', leasePdf('Hanoi home tenancy (demo)'), 'Hanoi-home-tenancy.pdf');
  await item('tom', { kind: 'document', title: 'Hanoi home tenancy', body: 'Demo file, not a real contract.', attachmentIds: [lease.id], collection: 'rental', docType: 'lease', date: '2026-09-15', expiresOn: '2027-09-14', tags: ['documents'] });
  const inv = await upload('james', meterPng(), 'inventory-photo.png');
  await item('james', { kind: 'photo', title: 'Boxes 1 to 12, packed', body: 'Photo for the inventory.', attachmentIds: [inv.id], tags: ['moving'] });

  // Personal Library: contacts, qualifications and books, only visible to each person
  const personal = async (k: Who, data: Record<string, unknown>) => {
    const { id } = await A(k).client.call<{ id: string }>('GET', '/api/me/personal');
    return A(k).client.call('POST', `/api/households/${id}/items`, data);
  };
  const doc = async (k: Who, title: string, body: string, file: string) => {
    const { id } = await A(k).client.call<{ id: string }>('GET', '/api/me/personal');
    const f = await A(k).client.call<{ id: string }>('POST', `/api/households/${id}/files`, undefined, { bytes: leasePdf(title), name: file });
    return A(k).client.call('POST', `/api/households/${id}/items`, { kind: 'document', title, body, attachmentIds: [f.id], tags: ['qualification'] });
  };
  await doc('tom', 'Certificate III in Commercial Cookery', 'Demo file.', 'Cert-III.pdf');
  await doc('tom', 'Certificate IV', 'Demo file.', 'Cert-IV.pdf');
  await doc('tom', 'Diploma of Hospitality Management (AQF Level 5)', 'Demo file.', 'Diploma.pdf');
  await doc('tom', 'PTE Academic score report', 'Demo file. Valid to 17 Oct 2026.', 'PTE.pdf');
  for (const [name, body] of [['Ms Niki, Fontys admissions (demo)', 'Fontys ICT Student Desk'], ['Student Office, BUas (demo)', 'Applied Data Science and AI'], ['Inholland admissions (demo)', 'Information Technology, Haarlem'], ['Chef Minh, Hanoi hotel kitchen (demo)', 'Meeting on 7 Oct']] as const)
    await personal('tom', { kind: 'note', title: name, body, collection: 'contacts' });
  for (const [t, b] of [['Applied AI textbook', 'Borrowed for study'], ['Python crash course', 'Due 16 Oct 2026'], ['Dutch for beginners', 'Chapter 1 to 3']] as const)
    await personal('tom', { kind: 'note', title: `📘 ${t}`, body: b, tags: ['study'] });
  await doc('james', 'Storage unit agreement (demo)', 'Demo file.', 'Storage.pdf');
  await doc('james', 'Shipping quote, sea freight to Hanoi (demo)', 'Demo file.', 'Quote.pdf');
  await doc('james', 'Inventory list v2 (demo)', 'Demo file.', 'Inventory.pdf');
  for (const [name, body] of [['Storage manager (demo)', 'Unit access and survey'], ['Shipping coordinator (demo)', 'Sea freight booking'], ['Local mover (demo)', 'Heavy items']] as const)
    await personal('james', { kind: 'note', title: name, body, collection: 'contacts' });
  await doc('ella', 'Lettre de motivation (brouillon, démo)', 'Fichier de démonstration.', 'Lettre.pdf');
  await doc('ella', 'Relevé de notes (démo)', 'Fichier de démonstration.', 'Releve.pdf');
  for (const [name, body] of [['Conseillère d’orientation (démo)', 'Rendez-vous le 2 novembre'], ['Lucas, camarade de classe (démo)', 'Groupe de révision']] as const)
    await personal('ella', { kind: 'note', title: name, body, collection: 'contacts' });
  for (const t of ['Introduction à l’IA', 'Bases de données', 'Néerlandais A1']) await personal('ella', { kind: 'note', title: `📘 ${t}`, tags: ['études'] });

  // Chat: group, private chats, and MATE
  const send = (k: Who, data: Record<string, unknown>) => A(k).client.call('POST', `/api/households/${hid}/messages`, data);
  const pizza = await upload('tom', pizzaPng(), 'dinner.png');
  let n = 0;
  for (const [from, text, sticker] of GROUP) {
    await send(from, sticker ? { sticker } : { text });
    if (++n === 6) await send('tom', { text: 'Dinner tonight, Sunday: lemongrass chicken 🍗', fileId: pizza.id });
  }
  for (const [pair, msgs] of Object.entries(DMS)) {
    const [a, b] = pair.split(':') as [Who, Who];
    for (const [from, text, sticker] of msgs) {
      const other = from === a ? b : a;
      await send(from, { conversation: `dm:${A(other).id}`, ...(sticker ? { sticker } : { text }) });
    }
  }
  for (const text of WITH_MATE) await send('tom', { conversation: 'bot:tom', text });

  return { householdId: hid, home: 'Williams House', people: PEOPLE.map((p) => ({ name: p.name, email: A(p.key).email, avatar: p.avatar })) };
}
