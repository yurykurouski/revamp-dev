/**
 * Fixed UI text of the generated MVP (REV-25).
 *
 * The MVP copy itself is written by the MvpContentAgent in the original site's language;
 * this module localises the template chrome (section tags, form labels, footer) and the
 * deterministic fallback copy so the whole page reads in one language. Languages without a
 * dictionary fall back to English chrome, while `<html lang>` still declares the site language.
 */

export const MVP_UI_LANGUAGES = ['en', 'ru', 'be', 'pl', 'lt'] as const;
export type MvpUiLanguage = (typeof MVP_UI_LANGUAGES)[number];

type Niche = 'dental' | 'auto' | 'legal' | 'beauty' | 'restaurant' | 'fitness' | 'other';

export interface MvpStrings {
  // Template chrome
  sendRequest: string;
  callUs: string;
  emailUs: string;
  contactUs: string;
  servicesHeading: (business: string) => string;
  chooseService: string;
  reviewSourceWebsite: string;
  aboutTag: string;
  servicesTag: string;
  reviewsTag: string;
  reviewsHeading: (business: string) => string;
  getInTouchTag: string;
  bookingDescription: (business: string) => string;
  nameLabel: string;
  namePlaceholder: string;
  phoneLabel: string;
  phonePlaceholder: string;
  serviceLabel: string;
  generalConsultation: string;
  notesLabel: string;
  notesPlaceholder: string;
  consent: string;
  bookNow: string;
  sending: string;
  successTitle: string;
  successDescription: string;
  /** Client-side confirmation; {name}, {service} and {phone} are filled in the browser */
  successDetail: string;
  sendAnother: string;
  builtBy: string;
  contactsTitle: string;
  sendUsRequest: string;
  openingHoursTitle: string;
  rightsReserved: string;
  redesignConcept: string;
  // Deterministic fallback copy
  ourBusiness: string;
  customer: string;
  nicheLabels: Record<Niche, string>;
  nicheCta: Record<Niche, string>;
  aboutHeading: (business: string) => string;
  serviceAt: (service: string, business: string) => string;
  nicheBy: (niche: string, business: string, city?: string) => string;
  ratingBadge: (value: number | string) => string;
  since: (year: number) => string;
  averageRatingFrom: (count: number) => string;
  averageRating: string;
  servingFor: (years: number) => string;
  testimonialsOnSite: string;
  offerCall: (phone: string) => string;
  offerOnline: string;
}

const en: MvpStrings = {
  sendRequest: 'Send a request',
  callUs: 'Call us',
  emailUs: 'Email us',
  contactUs: 'Contact us',
  servicesHeading: (b) => `What ${b} offers`,
  chooseService: 'Choose service',
  reviewSourceWebsite: 'Website',
  aboutTag: 'About',
  servicesTag: 'Services',
  reviewsTag: 'Reviews',
  reviewsHeading: (b) => `What customers say about ${b}`,
  getInTouchTag: 'Get in touch',
  bookingDescription: (b) => `Leave your details and ${b} will get back to you.`,
  nameLabel: 'Your name *',
  namePlaceholder: 'John Smith',
  phoneLabel: 'Phone number *',
  phonePlaceholder: 'Your phone number',
  serviceLabel: 'Service of interest',
  generalConsultation: 'General consultation',
  notesLabel: 'Comments or requests',
  notesPlaceholder: 'Add details or your preferred visit time...',
  consent: 'I consent to the processing of my personal data and agree to the privacy policy.',
  bookNow: 'Book now',
  sending: 'Sending...',
  successTitle: 'Thank you for reaching out!',
  successDescription: 'Your request has been received. Our specialist will contact you shortly.',
  successDetail: 'Thank you, {name}! Your request for "{service}" has been received. We will call you back at {phone} shortly.',
  sendAnother: 'Send another request',
  builtBy: 'Prototype built by the Revamp platform',
  contactsTitle: 'Contacts',
  sendUsRequest: 'Send us a request',
  openingHoursTitle: 'Opening hours',
  rightsReserved: 'All rights reserved.',
  redesignConcept: 'Redesign concept based on the original website',
  ourBusiness: 'Our business',
  customer: 'Customer',
  nicheLabels: {
    dental: 'Dental care',
    auto: 'Auto service',
    legal: 'Legal services',
    beauty: 'Beauty & care',
    restaurant: 'Restaurant',
    fitness: 'Fitness',
    other: 'Local business',
  },
  nicheCta: {
    dental: 'Book an appointment',
    auto: 'Book a service',
    legal: 'Get a consultation',
    beauty: 'Book a visit',
    restaurant: 'Reserve a table',
    fitness: 'Start training',
    other: 'Send a request',
  },
  aboutHeading: (b) => `About ${b}`,
  serviceAt: (s, b) => `${s} at ${b}.`,
  nicheBy: (n, b, c) => `${n} by ${b}${c ? ` in ${c}` : ''}.`,
  ratingBadge: (v) => `★ ${v} rating`,
  since: (y) => `Since ${y}`,
  averageRatingFrom: (n) => `Average rating from ${n} reviews`,
  averageRating: 'Average customer rating',
  servingFor: (y) => `Serving customers for ${y}+ years`,
  testimonialsOnSite: 'Customer testimonials on our site',
  offerCall: (p) => `Call ${p} or send a request online`,
  offerOnline: 'Send a request online and we will get back to you',
};

const ru: MvpStrings = {
  sendRequest: 'Оставить заявку',
  callUs: 'Позвонить',
  emailUs: 'Написать нам',
  contactUs: 'Связаться с нами',
  servicesHeading: (b) => `Что предлагает ${b}`,
  chooseService: 'Выбрать услугу',
  reviewSourceWebsite: 'Сайт',
  aboutTag: 'О нас',
  servicesTag: 'Услуги',
  reviewsTag: 'Отзывы',
  reviewsHeading: (b) => `Что клиенты говорят о ${b}`,
  getInTouchTag: 'Связаться',
  bookingDescription: (b) => `Оставьте свои контакты, и ${b} свяжется с вами.`,
  nameLabel: 'Ваше имя *',
  namePlaceholder: 'Иван Иванов',
  phoneLabel: 'Номер телефона *',
  phonePlaceholder: 'Ваш номер телефона',
  serviceLabel: 'Интересующая услуга',
  generalConsultation: 'Общая консультация',
  notesLabel: 'Комментарии или пожелания',
  notesPlaceholder: 'Добавьте детали или удобное время визита...',
  consent: 'Я даю согласие на обработку персональных данных и принимаю политику конфиденциальности.',
  bookNow: 'Записаться',
  sending: 'Отправка...',
  successTitle: 'Спасибо за обращение!',
  successDescription: 'Ваша заявка получена. Наш специалист скоро свяжется с вами.',
  successDetail: 'Спасибо, {name}! Ваша заявка на «{service}» получена. Мы перезвоним вам по номеру {phone} в ближайшее время.',
  sendAnother: 'Отправить ещё одну заявку',
  builtBy: 'Прототип создан платформой Revamp',
  contactsTitle: 'Контакты',
  sendUsRequest: 'Оставить заявку',
  openingHoursTitle: 'Часы работы',
  rightsReserved: 'Все права защищены.',
  redesignConcept: 'Концепция редизайна на основе оригинального сайта',
  ourBusiness: 'Наша компания',
  customer: 'Клиент',
  nicheLabels: {
    dental: 'Стоматология',
    auto: 'Автосервис',
    legal: 'Юридические услуги',
    beauty: 'Красота и уход',
    restaurant: 'Ресторан',
    fitness: 'Фитнес',
    other: 'Местный бизнес',
  },
  nicheCta: {
    dental: 'Записаться на приём',
    auto: 'Записаться на сервис',
    legal: 'Получить консультацию',
    beauty: 'Записаться',
    restaurant: 'Забронировать столик',
    fitness: 'Начать тренировки',
    other: 'Оставить заявку',
  },
  aboutHeading: (b) => `О компании ${b}`,
  serviceAt: (s, b) => `${s} — ${b}.`,
  nicheBy: (n, b, c) => `${n}: ${b}${c ? `, ${c}` : ''}.`,
  ratingBadge: (v) => `★ Рейтинг ${v}`,
  since: (y) => `С ${y} года`,
  averageRatingFrom: (n) => `Средняя оценка по ${n} отзывам`,
  averageRating: 'Средняя оценка клиентов',
  servingFor: (y) => `Работаем для клиентов более ${y} лет`,
  testimonialsOnSite: 'Отзывы клиентов на нашем сайте',
  offerCall: (p) => `Позвоните по номеру ${p} или оставьте заявку онлайн`,
  offerOnline: 'Оставьте заявку онлайн, и мы свяжемся с вами',
};

const be: MvpStrings = {
  sendRequest: 'Пакінуць заяўку',
  callUs: 'Патэлефанаваць',
  emailUs: 'Напісаць нам',
  contactUs: 'Звязацца з намі',
  servicesHeading: (b) => `Што прапануе ${b}`,
  chooseService: 'Выбраць паслугу',
  reviewSourceWebsite: 'Сайт',
  aboutTag: 'Пра нас',
  servicesTag: 'Паслугі',
  reviewsTag: 'Водгукі',
  reviewsHeading: (b) => `Што кліенты кажуць пра ${b}`,
  getInTouchTag: 'Звязацца',
  bookingDescription: (b) => `Пакіньце свае кантакты, і ${b} звяжацца з вамі.`,
  nameLabel: 'Ваша імя *',
  namePlaceholder: 'Янка Купала',
  phoneLabel: 'Нумар тэлефона *',
  phonePlaceholder: 'Ваш нумар тэлефона',
  serviceLabel: 'Паслуга, якая цікавіць',
  generalConsultation: 'Агульная кансультацыя',
  notesLabel: 'Каментарыі або пажаданні',
  notesPlaceholder: 'Дадайце падрабязнасці або зручны час візіту...',
  consent: 'Я даю згоду на апрацоўку персанальных даных і прымаю палітыку прыватнасці.',
  bookNow: 'Запісацца',
  sending: 'Адпраўка...',
  successTitle: 'Дзякуй за зварот!',
  successDescription: 'Ваша заяўка атрымана. Наш спецыяліст хутка звяжацца з вамі.',
  successDetail: 'Дзякуй, {name}! Ваша заяўка на «{service}» атрымана. Мы хутка перазвонім вам па нумары {phone}.',
  sendAnother: 'Адправіць яшчэ адну заяўку',
  builtBy: 'Прататып створаны платформай Revamp',
  contactsTitle: 'Кантакты',
  sendUsRequest: 'Пакінуць заяўку',
  openingHoursTitle: 'Гадзіны працы',
  rightsReserved: 'Усе правы абаронены.',
  redesignConcept: 'Канцэпцыя рэдызайну на аснове арыгінальнага сайта',
  ourBusiness: 'Наша кампанія',
  customer: 'Кліент',
  nicheLabels: {
    dental: 'Стаматалогія',
    auto: 'Аўтасэрвіс',
    legal: 'Юрыдычныя паслугі',
    beauty: 'Прыгажосць і догляд',
    restaurant: 'Рэстаран',
    fitness: 'Фітнес',
    other: 'Мясцовы бізнес',
  },
  nicheCta: {
    dental: 'Запісацца на прыём',
    auto: 'Запісацца на сэрвіс',
    legal: 'Атрымаць кансультацыю',
    beauty: 'Запісацца',
    restaurant: 'Забраніраваць столік',
    fitness: 'Пачаць трэніроўкі',
    other: 'Пакінуць заяўку',
  },
  aboutHeading: (b) => `Пра кампанію ${b}`,
  serviceAt: (s, b) => `${s} — ${b}.`,
  nicheBy: (n, b, c) => `${n}: ${b}${c ? `, ${c}` : ''}.`,
  ratingBadge: (v) => `★ Рэйтынг ${v}`,
  since: (y) => `З ${y} года`,
  averageRatingFrom: (n) => `Сярэдняя ацэнка па ${n} водгуках`,
  averageRating: 'Сярэдняя ацэнка кліентаў',
  servingFor: (y) => `Працуем для кліентаў больш за ${y} гадоў`,
  testimonialsOnSite: 'Водгукі кліентаў на нашым сайце',
  offerCall: (p) => `Патэлефануйце па нумары ${p} або пакіньце заяўку анлайн`,
  offerOnline: 'Пакіньце заяўку анлайн, і мы звяжамся з вамі',
};

const pl: MvpStrings = {
  sendRequest: 'Wyślij zapytanie',
  callUs: 'Zadzwoń',
  emailUs: 'Napisz do nas',
  contactUs: 'Skontaktuj się',
  servicesHeading: (b) => `Oferta ${b}`,
  chooseService: 'Wybierz usługę',
  reviewSourceWebsite: 'Strona',
  aboutTag: 'O nas',
  servicesTag: 'Usługi',
  reviewsTag: 'Opinie',
  reviewsHeading: (b) => `Co klienci mówią o ${b}`,
  getInTouchTag: 'Kontakt',
  bookingDescription: (b) => `Zostaw swoje dane, a ${b} skontaktuje się z Tobą.`,
  nameLabel: 'Imię i nazwisko *',
  namePlaceholder: 'Jan Kowalski',
  phoneLabel: 'Numer telefonu *',
  phonePlaceholder: 'Twój numer telefonu',
  serviceLabel: 'Interesująca usługa',
  generalConsultation: 'Konsultacja ogólna',
  notesLabel: 'Uwagi lub prośby',
  notesPlaceholder: 'Dodaj szczegóły lub preferowany termin wizyty...',
  consent: 'Wyrażam zgodę na przetwarzanie moich danych osobowych i akceptuję politykę prywatności.',
  bookNow: 'Umów się',
  sending: 'Wysyłanie...',
  successTitle: 'Dziękujemy za kontakt!',
  successDescription: 'Twoje zgłoszenie zostało przyjęte. Nasz specjalista wkrótce się z Tobą skontaktuje.',
  successDetail: 'Dziękujemy, {name}! Twoje zgłoszenie dotyczące „{service}” zostało przyjęte. Wkrótce oddzwonimy pod numer {phone}.',
  sendAnother: 'Wyślij kolejne zgłoszenie',
  builtBy: 'Prototyp stworzony przez platformę Revamp',
  contactsTitle: 'Kontakt',
  sendUsRequest: 'Wyślij zapytanie',
  openingHoursTitle: 'Godziny otwarcia',
  rightsReserved: 'Wszelkie prawa zastrzeżone.',
  redesignConcept: 'Koncepcja nowego projektu na podstawie oryginalnej strony',
  ourBusiness: 'Nasza firma',
  customer: 'Klient',
  nicheLabels: {
    dental: 'Stomatologia',
    auto: 'Serwis samochodowy',
    legal: 'Usługi prawne',
    beauty: 'Uroda i pielęgnacja',
    restaurant: 'Restauracja',
    fitness: 'Fitness',
    other: 'Lokalna firma',
  },
  nicheCta: {
    dental: 'Umów wizytę',
    auto: 'Umów serwis',
    legal: 'Umów konsultację',
    beauty: 'Umów wizytę',
    restaurant: 'Zarezerwuj stolik',
    fitness: 'Zacznij trening',
    other: 'Wyślij zapytanie',
  },
  aboutHeading: (b) => `O firmie ${b}`,
  serviceAt: (s, b) => `${s} — ${b}.`,
  nicheBy: (n, b, c) => `${n}: ${b}${c ? `, ${c}` : ''}.`,
  ratingBadge: (v) => `★ Ocena ${v}`,
  since: (y) => `Od ${y} roku`,
  averageRatingFrom: (n) => `Średnia ocena z ${n} opinii`,
  averageRating: 'Średnia ocena klientów',
  servingFor: (y) => `Obsługujemy klientów od ponad ${y} lat`,
  testimonialsOnSite: 'Opinie klientów na naszej stronie',
  offerCall: (p) => `Zadzwoń pod numer ${p} lub wyślij zapytanie online`,
  offerOnline: 'Wyślij zapytanie online, a skontaktujemy się z Tobą',
};

const lt: MvpStrings = {
  sendRequest: 'Siųsti užklausą',
  callUs: 'Skambinti',
  emailUs: 'Rašykite mums',
  contactUs: 'Susisiekite',
  servicesHeading: (b) => `Ką siūlo ${b}`,
  chooseService: 'Pasirinkti paslaugą',
  reviewSourceWebsite: 'Svetainė',
  aboutTag: 'Apie mus',
  servicesTag: 'Paslaugos',
  reviewsTag: 'Atsiliepimai',
  reviewsHeading: (b) => `Ką klientai sako apie ${b}`,
  getInTouchTag: 'Susisiekite',
  bookingDescription: (b) => `Palikite savo kontaktus ir ${b} su jumis susisieks.`,
  nameLabel: 'Jūsų vardas *',
  namePlaceholder: 'Jonas Jonaitis',
  phoneLabel: 'Telefono numeris *',
  phonePlaceholder: 'Jūsų telefono numeris',
  serviceLabel: 'Dominanti paslauga',
  generalConsultation: 'Bendra konsultacija',
  notesLabel: 'Komentarai ar pageidavimai',
  notesPlaceholder: 'Pridėkite detalių arba pageidaujamą vizito laiką...',
  consent: 'Sutinku, kad mano asmens duomenys būtų tvarkomi, ir sutinku su privatumo politika.',
  bookNow: 'Registruotis',
  sending: 'Siunčiama...',
  successTitle: 'Ačiū, kad susisiekėte!',
  successDescription: 'Jūsų užklausa gauta. Mūsų specialistas netrukus su jumis susisieks.',
  successDetail: 'Ačiū, {name}! Jūsų užklausa „{service}“ gauta. Netrukus paskambinsime numeriu {phone}.',
  sendAnother: 'Siųsti kitą užklausą',
  builtBy: 'Prototipą sukūrė Revamp platforma',
  contactsTitle: 'Kontaktai',
  sendUsRequest: 'Siųsti užklausą',
  openingHoursTitle: 'Darbo laikas',
  rightsReserved: 'Visos teisės saugomos.',
  redesignConcept: 'Naujo dizaino koncepcija pagal originalią svetainę',
  ourBusiness: 'Mūsų įmonė',
  customer: 'Klientas',
  nicheLabels: {
    dental: 'Odontologija',
    auto: 'Autoservisas',
    legal: 'Teisinės paslaugos',
    beauty: 'Grožis ir priežiūra',
    restaurant: 'Restoranas',
    fitness: 'Sportas',
    other: 'Vietos verslas',
  },
  nicheCta: {
    dental: 'Registruotis vizitui',
    auto: 'Registruotis servisui',
    legal: 'Gauti konsultaciją',
    beauty: 'Registruotis vizitui',
    restaurant: 'Rezervuoti staliuką',
    fitness: 'Pradėti treniruotes',
    other: 'Siųsti užklausą',
  },
  aboutHeading: (b) => `Apie ${b}`,
  serviceAt: (s, b) => `${s} — ${b}.`,
  nicheBy: (n, b, c) => `${n}: ${b}${c ? `, ${c}` : ''}.`,
  ratingBadge: (v) => `★ Įvertinimas ${v}`,
  since: (y) => `Nuo ${y} m.`,
  averageRatingFrom: (n) => `Vidutinis įvertinimas iš ${n} atsiliepimų`,
  averageRating: 'Vidutinis klientų įvertinimas',
  servingFor: (y) => `Klientus aptarnaujame daugiau nei ${y} m.`,
  testimonialsOnSite: 'Klientų atsiliepimai mūsų svetainėje',
  offerCall: (p) => `Skambinkite ${p} arba siųskite užklausą internetu`,
  offerOnline: 'Siųskite užklausą internetu ir mes su jumis susisieksime',
};

const DICTIONARIES: Record<MvpUiLanguage, MvpStrings> = { en, ru, be, pl, lt };

/**
 * Reduces a BCP 47 tag from the original site ("pl-PL", "EN_us") to its primary language
 * subtag, or undefined when it is not a plausible language code.
 */
export function parseLanguageTag(raw?: string | null): string | undefined {
  const primary = (raw || '').trim().toLowerCase().split(/[-_]/)[0] || '';
  return /^[a-z]{2,3}$/.test(primary) ? primary : undefined;
}

/**
 * The original site's language tag as the site wrote it ("pl-PL" stays "pl-PL"), or undefined
 * when it is not a well-formed BCP 47 tag. Underscores ("en_US") become hyphens, as HTML requires.
 */
export function sanitizeLanguageTag(raw?: string | null): string | undefined {
  const tag = (raw || '').trim().replace(/_/g, '-');
  return /^[a-z]{2,3}(-[a-z0-9]{1,8})*$/i.test(tag) ? tag : undefined;
}

/** Fixed UI text for a site language; languages without a dictionary get English */
export function getMvpStrings(language?: string | null): MvpStrings {
  const code = parseLanguageTag(language) ?? 'en';
  return (MVP_UI_LANGUAGES as readonly string[]).includes(code) ? DICTIONARIES[code as MvpUiLanguage] : en;
}

/** English name of a language code for LLM instructions ("pl" → "Polish") */
export function languageDisplayName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
}
