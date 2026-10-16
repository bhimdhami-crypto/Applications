/**
 * Name pools for the synthetic workforce. Common given names and surnames, combined at random,
 * so any resemblance to a real person is coincidence. Pairs are [Latin script, local script].
 */
export type NamePart = string | [string, string];

export interface NamePool {
  male: NamePart[];
  female: NamePart[];
  last: NamePart[];
  /** How the local-script full name is written */
  localOrder?: 'family-first-joined' | 'given-first-spaced';
  phonePrefix: string;
  universities: string[];
}

export const NAME_POOLS: Record<string, NamePool> = {
  KE: {
    male: ['Brian', 'Kevin', 'Dennis', 'Collins', 'Kamau', 'Otieno', 'Kiprono', 'Mwangi', 'Ochieng', 'Wafula', 'Peter', 'Joseph', 'Samuel', 'Victor', 'Felix', 'Eric', 'Allan', 'Ian'],
    female: ['Wanjiru', 'Achieng', 'Njeri', 'Akinyi', 'Chebet', 'Wambui', 'Faith', 'Mercy', 'Grace', 'Joy', 'Ann', 'Naliaka', 'Mumbi', 'Atieno', 'Esther', 'Lucy', 'Caroline', 'Sharon'],
    last: ['Kamau', 'Otieno', 'Mwangi', 'Wanjiku', 'Odhiambo', 'Kiptoo', 'Wekesa', 'Njoroge', 'Kariuki', 'Omondi', 'Cheruiyot', 'Mutua', 'Kibet', 'Achola', 'Ndungu', 'Barasa', 'Muthoni', 'Rotich'],
    phonePrefix: '+254 7',
    universities: ['University of Nairobi', 'Strathmore University', 'Kenyatta University', 'Moi University', 'JKUAT'],
  },
  UG: {
    male: ['Okello', 'Mugisha', 'Ssemakula', 'Tumusiime', 'Kato', 'Opio', 'Byaruhanga', 'Mukasa', 'Ronald', 'Isaac', 'Moses', 'Patrick', 'Denis', 'Andrew', 'Henry', 'Paul'],
    female: ['Nakato', 'Namubiru', 'Akello', 'Atuhaire', 'Nabirye', 'Kemigisha', 'Nansubuga', 'Babirye', 'Sarah', 'Doreen', 'Brenda', 'Juliet', 'Rose', 'Agnes', 'Irene', 'Ruth'],
    last: ['Ochola', 'Mugisha', 'Ssempijja', 'Tumwine', 'Kizza', 'Nsubuga', 'Byamukama', 'Lubega', 'Ouma', 'Kaggwa', 'Mutebi', 'Asiimwe', 'Musoke', 'Kiwanuka', 'Odongo', 'Wasswa'],
    phonePrefix: '+256 7',
    universities: ['Makerere University', 'Uganda Christian University', 'Kyambogo University', 'Mbarara University'],
  },
  TZ: {
    male: ['Hamisi', 'Juma', 'Baraka', 'Emmanuel', 'Mussa', 'Rajabu', 'Godfrey', 'Elia', 'Salim', 'Frank', 'Daudi', 'Omari', 'Nassoro', 'Joseph', 'Peter', 'Athumani'],
    female: ['Neema', 'Rehema', 'Zawadi', 'Amina', 'Mwanaidi', 'Upendo', 'Halima', 'Mariam', 'Agnes', 'Saida', 'Furaha', 'Anna', 'Esther', 'Asha', 'Zuhura', 'Witness'],
    last: ['Kimaro', 'Mushi', 'Massawe', 'Mrema', 'Mollel', 'Swai', 'Lyimo', 'Shirima', 'Mbwana', 'Mwakyusa', 'Kombo', 'Salum', 'Mwita', 'Njau', 'Temba', 'Komba'],
    phonePrefix: '+255 7',
    universities: ['University of Dar es Salaam', 'Ardhi University', 'Sokoine University', 'University of Dodoma'],
  },
  EG: {
    male: [['Ahmed', 'أحمد'], ['Mohamed', 'محمد'], ['Omar', 'عمر'], ['Youssef', 'يوسف'], ['Karim', 'كريم'], ['Mostafa', 'مصطفى'], ['Mahmoud', 'محمود'], ['Tarek', 'طارق'], ['Hany', 'هاني'], ['Amr', 'عمرو'], ['Sherif', 'شريف'], ['Hossam', 'حسام']],
    female: [['Yasmin', 'ياسمين'], ['Nour', 'نور'], ['Mariam', 'مريم'], ['Salma', 'سلمى'], ['Heba', 'هبة'], ['Dina', 'دينا'], ['Rana', 'رنا'], ['Aya', 'آية'], ['Mona', 'منى'], ['Sara', 'سارة'], ['Reem', 'ريم'], ['Laila', 'ليلى']],
    last: [['Mahmoud', 'محمود'], ['Hassan', 'حسن'], ['Ibrahim', 'إبراهيم'], ['Abdelrahman', 'عبد الرحمن'], ['Fathy', 'فتحي'], ['Saleh', 'صالح'], ['Mansour', 'منصور'], ['Farouk', 'فاروق'], ['Ali', 'علي'], ['Kamal', 'كمال'], ['Nasser', 'ناصر'], ['Soliman', 'سليمان']],
    localOrder: 'given-first-spaced',
    phonePrefix: '+20 10',
    universities: ['Cairo University', 'Ain Shams University', 'Alexandria University', 'American University in Cairo'],
  },
  FR: {
    male: ['Lucas', 'Hugo', 'Louis', 'Thomas', 'Nicolas', 'Julien', 'Antoine', 'Maxime', 'Pierre', 'Mathieu', 'Romain', 'Alexandre', 'Baptiste', 'Théo'],
    female: ['Camille', 'Léa', 'Manon', 'Chloé', 'Emma', 'Julie', 'Sarah', 'Inès', 'Laura', 'Marion', 'Pauline', 'Claire', 'Élodie', 'Anaïs'],
    last: ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'Fontaine'],
    phonePrefix: '+33 6',
    universities: ['Sorbonne Université', 'Université Lyon 1', 'École Polytechnique', 'Sciences Po', 'Université Paris-Saclay'],
  },
  IN: {
    male: [['Aarav', 'आरव'], ['Rohan', 'रोहन'], ['Arjun', 'अर्जुन'], ['Vikram', 'विक्रम'], ['Rahul', 'राहुल'], ['Amit', 'अमित'], ['Siddharth', 'सिद्धार्थ'], ['Karthik', 'कार्तिक'], ['Nikhil', 'निखिल'], ['Sanjay', 'संजय'], ['Aditya', 'आदित्य'], ['Varun', 'वरुण']],
    female: [['Priya', 'प्रिया'], ['Ananya', 'अनन्या'], ['Kavya', 'काव्या'], ['Sneha', 'स्नेहा'], ['Pooja', 'पूजा'], ['Divya', 'दिव्या'], ['Meera', 'मीरा'], ['Aishwarya', 'ऐश्वर्या'], ['Neha', 'नेहा'], ['Riya', 'रिया'], ['Lakshmi', 'लक्ष्मी'], ['Shreya', 'श्रेया']],
    last: [['Sharma', 'शर्मा'], ['Patel', 'पटेल'], ['Iyer', 'अय्यर'], ['Reddy', 'रेड्डी'], ['Nair', 'नायर'], ['Gupta', 'गुप्ता'], ['Kulkarni', 'कुलकर्णी'], ['Singh', 'सिंह'], ['Rao', 'राव'], ['Menon', 'मेनन'], ['Joshi', 'जोशी'], ['Desai', 'देसाई']],
    localOrder: 'given-first-spaced',
    phonePrefix: '+91 9',
    universities: ['IIT Bombay', 'IIT Madras', 'University of Delhi', 'Anna University', 'BITS Pilani', 'University of Pune'],
  },
  CN: {
    male: [['Wei', '伟'], ['Hao', '浩'], ['Jun', '军'], ['Lei', '磊'], ['Yang', '洋'], ['Tao', '涛'], ['Ming', '明'], ['Jie', '杰'], ['Peng', '鹏'], ['Chao', '超'], ['Bo', '博'], ['Kai', '凯']],
    female: [['Fang', '芳'], ['Na', '娜'], ['Min', '敏'], ['Jing', '静'], ['Li', '丽'], ['Yan', '燕'], ['Xue', '雪'], ['Ting', '婷'], ['Hui', '慧'], ['Lin', '琳'], ['Qian', '倩'], ['Yu', '玉']],
    last: [['Wang', '王'], ['Li', '李'], ['Zhang', '张'], ['Liu', '刘'], ['Chen', '陈'], ['Yang', '杨'], ['Huang', '黄'], ['Zhao', '赵'], ['Wu', '吴'], ['Zhou', '周'], ['Xu', '徐'], ['Sun', '孙']],
    localOrder: 'family-first-joined',
    phonePrefix: '+86 13',
    universities: ['Tsinghua University', 'Peking University', 'Fudan University', 'Shanghai Jiao Tong University', 'Zhejiang University'],
  },
  AU: {
    male: ['Jack', 'Oliver', 'William', 'Noah', 'James', 'Thomas', 'Lachlan', 'Ethan', 'Liam', 'Cooper', 'Daniel', 'Matthew', 'Ryan', 'Josh'],
    female: ['Charlotte', 'Olivia', 'Mia', 'Ava', 'Isla', 'Chloe', 'Sophie', 'Emily', 'Grace', 'Ruby', 'Zoe', 'Jessica', 'Hannah', 'Georgia'],
    last: ['Smith', 'Jones', 'Williams', 'Brown', 'Wilson', 'Taylor', 'Johnson', 'White', 'Martin', 'Anderson', 'Thompson', 'Nguyen', 'Walker', 'Kelly', 'Ryan', 'Murphy'],
    phonePrefix: '+61 4',
    universities: ['University of Sydney', 'University of Melbourne', 'UNSW Sydney', 'Monash University', 'Australian National University'],
  },
  NL: {
    male: ['Daan', 'Sem', 'Lucas', 'Bram', 'Thijs', 'Jesse', 'Ruben', 'Lars', 'Tim', 'Joost', 'Pieter', 'Bas', 'Stijn', 'Jeroen'],
    female: ['Emma', 'Sophie', 'Julia', 'Anouk', 'Lotte', 'Sanne', 'Fleur', 'Eva', 'Lisa', 'Iris', 'Femke', 'Maaike', 'Noor', 'Esther'],
    last: ['de Jong', 'Jansen', 'de Vries', 'van den Berg', 'van Dijk', 'Bakker', 'Janssen', 'Visser', 'Smit', 'Meijer', 'de Boer', 'Mulder', 'de Groot', 'Bos', 'Vos', 'Peters'],
    phonePrefix: '+31 6',
    universities: ['Universiteit van Amsterdam', 'TU Delft', 'Erasmus Universiteit Rotterdam', 'Universiteit Utrecht', 'Leiden University'],
  },
  JP: {
    male: [['Haruto', '陽翔'], ['Ren', '蓮'], ['Sota', '蒼太'], ['Takumi', '拓海'], ['Yuto', '悠斗'], ['Kenji', '健二'], ['Daiki', '大輝'], ['Hiroshi', '浩'], ['Shota', '翔太'], ['Kazuki', '一輝'], ['Ryo', '涼'], ['Naoki', '直樹']],
    female: [['Yui', '結衣'], ['Sakura', 'さくら'], ['Aoi', '葵'], ['Hina', '陽菜'], ['Mio', '美緒'], ['Yuka', '由香'], ['Ayaka', '彩花'], ['Tomoko', '智子'], ['Naomi', '直美'], ['Emi', '恵美'], ['Rin', '凛'], ['Kana', '香奈']],
    last: [['Sato', '佐藤'], ['Suzuki', '鈴木'], ['Takahashi', '高橋'], ['Tanaka', '田中'], ['Watanabe', '渡辺'], ['Ito', '伊藤'], ['Yamamoto', '山本'], ['Nakamura', '中村'], ['Kobayashi', '小林'], ['Kato', '加藤'], ['Yoshida', '吉田'], ['Yamada', '山田']],
    localOrder: 'family-first-joined',
    phonePrefix: '+81 90',
    universities: ['University of Tokyo', 'Kyoto University', 'Osaka University', 'Keio University', 'Waseda University'],
  },
  KR: {
    male: [['Min-jun', '민준'], ['Seo-jun', '서준'], ['Ji-ho', '지호'], ['Do-yun', '도윤'], ['Hyun-woo', '현우'], ['Jun-ho', '준호'], ['Sung-min', '성민'], ['Dong-hyun', '동현'], ['Jae-won', '재원'], ['Tae-yang', '태양'], ['Woo-jin', '우진'], ['Sang-hoon', '상훈']],
    female: [['Seo-yeon', '서연'], ['Ji-woo', '지우'], ['Ha-eun', '하은'], ['Min-seo', '민서'], ['Su-bin', '수빈'], ['Ye-jin', '예진'], ['Ji-hye', '지혜'], ['Eun-ji', '은지'], ['Yoon-ah', '윤아'], ['So-young', '소영'], ['Hye-jin', '혜진'], ['Da-eun', '다은']],
    last: [['Kim', '김'], ['Lee', '이'], ['Park', '박'], ['Choi', '최'], ['Jung', '정'], ['Kang', '강'], ['Cho', '조'], ['Yoon', '윤'], ['Jang', '장'], ['Lim', '임'], ['Han', '한'], ['Shin', '신']],
    localOrder: 'family-first-joined',
    phonePrefix: '+82 10',
    universities: ['Seoul National University', 'KAIST', 'Yonsei University', 'Korea University', 'POSTECH'],
  },
  ZA: {
    male: ['Pieter', 'Thabo', 'Sipho', 'Johan', 'Lwazi', 'Bongani', 'Mandla', 'Ruan', 'Kagiso', 'Themba', 'Andile', 'Jacques', 'Lerato', 'Neo'],
    female: ['Nomsa', 'Thandi', 'Zanele', 'Anika', 'Lindiwe', 'Palesa', 'Naledi', 'Chantelle', 'Precious', 'Ayanda', 'Busisiwe', 'Elize', 'Refilwe', 'Kelebogile'],
    last: ['Ndlovu', 'Dlamini', 'Nkosi', 'van der Merwe', 'Botha', 'Mokoena', 'Mahlangu', 'Pillay', 'Naidoo', 'Khumalo', 'Venter', 'Molefe', 'Zulu', 'Mthembu', 'Steyn', 'Sithole'],
    phonePrefix: '+27 8',
    universities: ['University of Cape Town', 'University of the Witwatersrand', 'Stellenbosch University', 'University of Pretoria', 'University of Johannesburg'],
  },
  NG: {
    male: ['Tunde', 'Chinedu', 'Emeka', 'Ibrahim', 'Oluwaseun', 'Musa', 'Babatunde', 'Ifeanyi', 'Yusuf', 'Segun', 'Obinna', 'Abdullahi', 'Kelechi', 'Femi'],
    female: ['Adaeze', 'Funmilayo', 'Ngozi', 'Aisha', 'Chiamaka', 'Bukola', 'Zainab', 'Ifeoma', 'Yetunde', 'Hauwa', 'Amaka', 'Temitope', 'Fatima', 'Kemi'],
    last: ['Bello', 'Okafor', 'Adeyemi', 'Okonkwo', 'Abubakar', 'Eze', 'Ogunleye', 'Nwosu', 'Ibrahim', 'Adebayo', 'Uche', 'Mohammed', 'Olawale', 'Chukwu', 'Danjuma', 'Afolabi'],
    phonePrefix: '+234 80',
    universities: ['University of Lagos', 'University of Ibadan', 'Obafemi Awolowo University', 'Ahmadu Bello University', 'Covenant University'],
  },
  MX: {
    male: ['Luis', 'José', 'Juan', 'Carlos', 'Miguel', 'Diego', 'Alejandro', 'Fernando', 'Jorge', 'Ricardo', 'Andrés', 'Santiago', 'Eduardo', 'Javier'],
    female: ['María', 'Guadalupe', 'Fernanda', 'Sofía', 'Valeria', 'Daniela', 'Andrea', 'Camila', 'Ximena', 'Mariana', 'Paola', 'Lucía', 'Gabriela', 'Regina'],
    last: ['Hernández', 'García', 'Martínez', 'López', 'González', 'Pérez', 'Rodríguez', 'Sánchez', 'Ramírez', 'Cruz', 'Flores', 'Gómez', 'Morales', 'Reyes', 'Jiménez', 'Torres'],
    phonePrefix: '+52 55',
    universities: ['UNAM', 'Tecnológico de Monterrey', 'IPN', 'Universidad de Guadalajara', 'ITAM'],
  },
  NZ: {
    male: ['Tipene', 'Nikau', 'James', 'Oliver', 'Tama', 'Wiremu', 'Hamish', 'Liam', 'Rawiri', 'Jack', 'Mason', 'Hemi', 'Lucas', 'Sam'],
    female: ['Aroha', 'Ana', 'Mere', 'Charlotte', 'Isla', 'Ella', 'Kiri', 'Amelia', 'Hana', 'Anahera', 'Olivia', 'Mia', 'Maia', 'Sophie', 'Ruby'],
    last: ['Taylor', 'Smith', 'Wilson', 'Ngata', 'Parata', 'Williams', 'Brown', 'Tane', 'Walker', 'Thompson', 'Wihongi', 'Campbell', 'Stewart', 'Te Rangi', 'Clarke', 'Kerr'],
    phonePrefix: '+64 21',
    universities: ['University of Auckland', 'Victoria University of Wellington', 'University of Otago', 'University of Canterbury', 'AUT'],
  },
};

/** Latin-script form of a name part */
export const latin = (p: NamePart) => (typeof p === 'string' ? p : p[0]);
/** Local-script form, or null when the name is written in Latin script */
export const local = (p: NamePart) => (typeof p === 'string' ? null : p[1]);
