// Bengali (বাংলা) names for every structure, body system and category shown in the Atlas.
const BASE = {
  ankle: 'গোড়ালির জয়েন্ট', elbow: 'কনুইয়ের জয়েন্ট', hip: 'নিতম্বের জয়েন্ট', knee: 'হাঁটুর জয়েন্ট',
  shoulder: 'কাঁধের জয়েন্ট', wrist: 'কবজির জয়েন্ট',
  abdominal_muscles: 'পেটের দেয়ালের পেশি', back_muscles: 'পিঠের পেশি', calf: 'পায়ের ডিমের পেশি',
  chest_muscles: 'বুকের (পেক্টোরাল) পেশি', deltoid: 'ডেলটয়েড (কাঁধের পেশি)', diaphragm: 'ডায়াফ্রাম (মধ্যচ্ছদা)',
  foot_muscles: 'পায়ের পাতার পেশি', forearm_muscles: 'সম্মুখবাহুর পেশি', gluteal: 'নিতম্বের পেশি',
  hamstrings: 'হ্যামস্ট্রিং (উরুর পিছনের পেশি)', hand_muscles: 'হাতের পেশি', iliopsoas: 'হিপ ফ্লেক্সর (ইলিওপসোয়াস)',
  adductors: 'ভিতরের উরুর পেশি (অ্যাডাক্টর)', intercostals: 'পাঁজরের মাঝের পেশি', neck_muscles: 'ঘাড়ের পেশি',
  pelvic_floor: 'শ্রোণিতলের পেশি', quadriceps: 'কোয়াড্রিসেপস (উরুর সামনের পেশি)', rotator_cuff: 'রোটেটর কাফ',
  shin_muscles: 'পায়ের সামনের নিচের পেশি', shoulder_muscles: 'কাঁধের বলয়ের পেশি', trapezius: 'ট্র্যাপিজিয়াস',
  upper_arm_muscles: 'উপরবাহুর পেশি',
  cranial_nerves: 'করোটিক ও চোখের স্নায়ু', spinal_cord: 'সুষুম্নাকাণ্ড (মেরুরজ্জু)',
  adrenal: 'অ্যাড্রেনাল গ্রন্থি', appendix: 'অ্যাপেন্ডিক্স', brain: 'মস্তিষ্ক', brainstem: 'ব্রেনস্টেম (মস্তিষ্কান্ড)',
  breast: 'স্তন', bronchi: 'ব্রঙ্কাই (শ্বাসনালির শাখা)', cerebellum: 'সেরিবেলাম (অনুমস্তিষ্ক)',
  esophagus: 'খাদ্যনালি', eye: 'চোখ', fallopian_tubes: 'ফেলোপিয়ান টিউব (ডিম্বনালি)',
  gallbladder: 'পিত্তথলি ও পিত্তনালি', heart: 'হৃৎপিণ্ড', kidney: 'বৃক্ক (কিডনি)', colon: 'বৃহদন্ত্র (কোলন)',
  larynx: 'ল্যারিংস (স্বরযন্ত্র)', liver: 'যকৃৎ (লিভার)', lung: 'ফুসফুস', reproductive: 'পুরুষের প্রজনন অঙ্গ',
  ovary: 'ডিম্বাশয়', pancreas: 'অগ্ন্যাশয় (প্যানক্রিয়াস)', pharynx: 'ফ্যারিংস (গলবিল)',
  pituitary: 'পিটুইটারি গ্রন্থি', prostate: 'প্রোস্টেট', salivary_glands: 'লালাগ্রন্থি', small_intestine: 'ক্ষুদ্রান্ত্র',
  spleen: 'প্লীহা', stomach: 'পাকস্থলী', thymus: 'থাইমাস', tongue: 'জিহ্বা', trachea: 'শ্বাসনালি (ট্রাকিয়া)',
  ureter: 'বৃক্কনালি (ইউরেটার)', bladder: 'মূত্রথলি', uterus: 'জরায়ু', vagina: 'যোনি',
  spine_cervical: 'ঘাড়ের মেরুদণ্ড (সার্ভিক্যাল)', clavicle: 'কণ্ঠাস্থি (কলারবোন)', foot: 'পায়ের পাতা',
  forearm: 'সম্মুখবাহুর হাড়', hand: 'হাত', mandible: 'নিচের চোয়াল (ম্যান্ডিবল)', patella: 'হাঁটুর বাটি',
  spine_lumbar: 'কোমরের মেরুদণ্ড (লাম্বার)', pelvis: 'শ্রোণিচক্র ও ত্রিকাস্থি', ribs: 'পাঁজরের হাড়',
  lower_leg: 'নিচের পায়ের হাড় (টিবিয়া/ফিবুলা)', scapula: 'স্ক্যাপুলা (কাঁধের হাড়)', skull: 'খুলি (করোটি)',
  sternum: 'স্টার্নাম (বুকের হাড়)', teeth: 'দাঁত ও মাড়ি', femur: 'ফিমার (উরুর হাড়)',
  spine_thoracic: 'বুকের মেরুদণ্ড (থোরাসিক)', humerus: 'হিউমেরাস (উপরবাহুর হাড়)', skin: 'ত্বক',
  aorta: 'মহাধমনি (অ্যাওর্টা)', arteries_abdomen: 'ধমনি — পেট', arteries_thorax: 'ধমনি — বুক',
  arteries_head: 'ধমনি — মাথা ও ঘাড়', arteries_arm_l: 'ধমনি — বাম হাত', arteries_leg_l: 'ধমনি — বাম পা',
  arteries_pelvis: 'ধমনি — শ্রোণি', arteries_arm_r: 'ধমনি — ডান হাত', arteries_leg_r: 'ধমনি — ডান পা',
  carotid: 'ক্যারোটিড ধমনি (গলার প্রধান ধমনি)', coronary_arteries: 'করোনারি ধমনি (হৃৎপিণ্ডের ধমনি)',
  vena_cava_inferior: 'নিম্ন মহাশিরা', pulmonary_vessels: 'ফুসফুসীয় রক্তনালি', vena_cava_superior: 'ঊর্ধ্ব মহাশিরা',
  veins_abdomen: 'শিরা — পেট', veins_thorax: 'শিরা — বুক', veins_arm_l: 'শিরা — বাম হাত', veins_leg_l: 'শিরা — বাম পা',
  veins_pelvis: 'শিরা — শ্রোণি', veins_arm_r: 'শিরা — ডান হাত', veins_leg_r: 'শিরা — ডান পা',
};
const SIDE = { l: ' (বাম)', r: ' (ডান)' };

/** Bengali name for a catalog key, e.g. "kidney_l" → "বৃক্ক (কিডনি) (বাম)". */
export function bnName(key) {
  if (BASE[key]) return BASE[key];
  const m = key.match(/^(.*)_([lr])$/);
  return m && BASE[m[1]] ? BASE[m[1]] + SIDE[m[2]] : '';
}

export const BN_SYSTEM = {
  skin: 'ত্বক', skeleton: 'কঙ্কাল', muscles: 'পেশি', organs: 'অঙ্গ', vessels: 'রক্তনালি', nerves: 'স্নায়ু', joints: 'জয়েন্ট',
};
export const BN_CATEGORY = {
  Musculoskeletal: 'পেশি-কঙ্কাল তন্ত্র', Respiratory: 'শ্বসনতন্ত্র', 'Renal / Urinary': 'মূত্রতন্ত্র', Neurological: 'স্নায়ুতন্ত্র',
  Endocrine: 'অন্তঃক্ষরা তন্ত্র', Digestive: 'পরিপাকতন্ত্র', Reproductive: 'প্রজননতন্ত্র', 'Eye / Sensory': 'চোখ / ইন্দ্রিয়',
  Cardiovascular: 'হৃদ্‌রক্তসংবহন তন্ত্র', 'Oral / ENT': 'মুখ / নাক-কান-গলা', 'Immune / Lymphatic': 'রোগপ্রতিরোধ / লসিকা তন্ত্র', Skin: 'ত্বক',
};
