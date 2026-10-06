# One-off: insert agent template-picker + prompt-polish keys into the
# existing `agents` block of all 14 locales. Reuses the add_agents_i18n.py
# insert_into_block technique; the six agents.templateCat.* keys are grouped
# into a nested `templateCat: { ... }` object inside the block.
import io
import os

LOCALES = [
    "zh-CN",
    "zh-TW",
    "en-US",
    "ja-JP",
    "de-DE",
    "es-ES",
    "fr-FR",
    "it-IT",
    "pl-PL",
    "pt-BR",
    "ru-RU",
    "tr-TR",
    "ca-ES",
    "bn-IN",
]

# (dotted key, {locale: text})
KEYS = [
    (
        "agents.templateLabel",
        {
            "zh-CN": "从模板开始",
            "zh-TW": "從範本開始",
            "en-US": "Start from a template",
            "ja-JP": "テンプレートから始める",
            "de-DE": "Mit einer Vorlage beginnen",
            "es-ES": "Empezar desde una plantilla",
            "fr-FR": "Commencer à partir d'un modèle",
            "it-IT": "Inizia da un modello",
            "pl-PL": "Zacznij od szablonu",
            "pt-BR": "Começar com um modelo",
            "ru-RU": "Начать с шаблона",
            "tr-TR": "Bir şablondan başla",
            "ca-ES": "Comença amb una plantilla",
            "bn-IN": "একটি টেমপ্লেট দিয়ে শুরু করুন",
        },
    ),
    (
        "agents.templateBlank",
        {
            "zh-CN": "自定义（空白）",
            "zh-TW": "自訂（空白）",
            "en-US": "Custom (blank)",
            "ja-JP": "カスタム（空欄）",
            "de-DE": "Eigene (leer)",
            "es-ES": "Personalizado (en blanco)",
            "fr-FR": "Personnalisé (vide)",
            "it-IT": "Personalizzato (vuoto)",
            "pl-PL": "Własny (pusty)",
            "pt-BR": "Personalizado (em branco)",
            "ru-RU": "Свой (пустой)",
            "tr-TR": "Özel (boş)",
            "ca-ES": "Personalitzat (en blanc)",
            "bn-IN": "কাস্টম (খালি)",
        },
    ),
    (
        "agents.templateCat.software",
        {
            "zh-CN": "软件开发",
            "zh-TW": "軟體開發",
            "en-US": "Software",
            "ja-JP": "ソフトウェア",
            "de-DE": "Software",
            "es-ES": "Software",
            "fr-FR": "Logiciel",
            "it-IT": "Software",
            "pl-PL": "Oprogramowanie",
            "pt-BR": "Software",
            "ru-RU": "Разработка ПО",
            "tr-TR": "Yazılım",
            "ca-ES": "Programari",
            "bn-IN": "সফটওয়্যার",
        },
    ),
    (
        "agents.templateCat.llm",
        {
            "zh-CN": "大模型",
            "zh-TW": "大模型",
            "en-US": "LLM",
            "ja-JP": "LLM",
            "de-DE": "LLM",
            "es-ES": "LLM",
            "fr-FR": "LLM",
            "it-IT": "LLM",
            "pl-PL": "LLM",
            "pt-BR": "LLM",
            "ru-RU": "LLM",
            "tr-TR": "LLM",
            "ca-ES": "LLM",
            "bn-IN": "এলএলএম",
        },
    ),
    (
        "agents.templateCat.business",
        {
            "zh-CN": "商业",
            "zh-TW": "商業",
            "en-US": "Business",
            "ja-JP": "ビジネス",
            "de-DE": "Business",
            "es-ES": "Negocios",
            "fr-FR": "Affaires",
            "it-IT": "Business",
            "pl-PL": "Biznes",
            "pt-BR": "Negócios",
            "ru-RU": "Бизнес",
            "tr-TR": "İş",
            "ca-ES": "Negocis",
            "bn-IN": "ব্যবসা",
        },
    ),
    (
        "agents.templateCat.education",
        {
            "zh-CN": "教育",
            "zh-TW": "教育",
            "en-US": "Education",
            "ja-JP": "教育",
            "de-DE": "Bildung",
            "es-ES": "Educación",
            "fr-FR": "Éducation",
            "it-IT": "Istruzione",
            "pl-PL": "Edukacja",
            "pt-BR": "Educação",
            "ru-RU": "Образование",
            "tr-TR": "Eğitim",
            "ca-ES": "Educació",
            "bn-IN": "শিক্ষা",
        },
    ),
    (
        "agents.templateCat.creative",
        {
            "zh-CN": "创作",
            "zh-TW": "創作",
            "en-US": "Creative",
            "ja-JP": "クリエイティブ",
            "de-DE": "Kreativ",
            "es-ES": "Creativo",
            "fr-FR": "Créatif",
            "it-IT": "Creativo",
            "pl-PL": "Kreatywne",
            "pt-BR": "Criativo",
            "ru-RU": "Творчество",
            "tr-TR": "Yaratıcı",
            "ca-ES": "Creatiu",
            "bn-IN": "সৃজনশীল",
        },
    ),
    (
        "agents.templateCat.general",
        {
            "zh-CN": "通用",
            "zh-TW": "通用",
            "en-US": "General",
            "ja-JP": "汎用",
            "de-DE": "Allgemein",
            "es-ES": "General",
            "fr-FR": "Général",
            "it-IT": "Generale",
            "pl-PL": "Ogólne",
            "pt-BR": "Geral",
            "ru-RU": "Общие",
            "tr-TR": "Genel",
            "ca-ES": "General",
            "bn-IN": "সাধারণ",
        },
    ),
    (
        "agents.polishPrompt",
        {
            "zh-CN": "润色提示词",
            "zh-TW": "潤飾提示詞",
            "en-US": "Polish prompt",
            "ja-JP": "プロンプトを磨く",
            "de-DE": "Prompt verfeinern",
            "es-ES": "Pulir el prompt",
            "fr-FR": "Peaufiner le prompt",
            "it-IT": "Rifinisci il prompt",
            "pl-PL": "Wypoleruj prompt",
            "pt-BR": "Polir o prompt",
            "ru-RU": "Улучшить промпт",
            "tr-TR": "İstemi cilala",
            "ca-ES": "Poleix el prompt",
            "bn-IN": "প্রম্পট পরিমার্জন",
        },
    ),
    (
        "agents.polishing",
        {
            "zh-CN": "润色中",
            "zh-TW": "潤飾中",
            "en-US": "Polishing…",
            "ja-JP": "磨いています…",
            "de-DE": "Verfeinern…",
            "es-ES": "Puliendo…",
            "fr-FR": "Peaufinage…",
            "it-IT": "Rifinitura…",
            "pl-PL": "Polerowanie…",
            "pt-BR": "Polindo…",
            "ru-RU": "Улучшение…",
            "tr-TR": "Cilalanıyor…",
            "ca-ES": "Polint…",
            "bn-IN": "পরিমার্জন চলছে…",
        },
    ),
    (
        "agents.polishFailed",
        {
            "zh-CN": "提示词润色失败",
            "zh-TW": "提示詞潤飾失敗",
            "en-US": "Failed to polish the prompt",
            "ja-JP": "プロンプトの研磨に失敗しました",
            "de-DE": "Prompt konnte nicht verfeinert werden",
            "es-ES": "Error al pulir el prompt",
            "fr-FR": "Échec du peaufinage du prompt",
            "it-IT": "Rifinitura del prompt non riuscita",
            "pl-PL": "Nie udało się wypolerować promptu",
            "pt-BR": "Falha ao polir o prompt",
            "ru-RU": "Не удалось улучшить промпт",
            "tr-TR": "İstem cilalanamadı",
            "ca-ES": "No s'ha pogut polir el prompt",
            "bn-IN": "প্রম্পট পরিমার্জন ব্যর্থ হয়েছে",
        },
    ),
]


def esc(s):
    return s.replace("\\", "\\\\").replace('"', '\\"')


def build_lines(locale):
    """Lines to append inside the agents block; consecutive templateCat.*
    keys collapse into one nested object."""
    lines = []
    in_cat = False
    for dotted, table in KEYS:
        key = dotted.split(".", 1)[1]
        value = esc(table[locale])
        if key.startswith("templateCat."):
            if not in_cat:
                lines.append("    templateCat: {")
                in_cat = True
            lines.append(f'      {key[len("templateCat.") :]}: "{value}",')
        else:
            if in_cat:
                lines.append("    },")
                in_cat = False
            lines.append(f'    {key}: "{value}",')
    if in_cat:
        lines.append("    },")
    return lines


def insert_into_block(lines, block_name, new_lines):
    """Insert new_lines just before the closing line of `  block_name: {`."""
    start = next(i for i, ln in enumerate(lines) if ln.strip() == f"{block_name}: {{")
    # Start one level deep (the block's own opening brace); the closing line
    # is the first line that brings the depth back to zero.
    depth = 1
    for i in range(start + 1, len(lines)):
        s = lines[i]
        depth += s.count("{") - s.count("}")
        if depth == 0 and s.strip().startswith("}"):
            return lines[:i] + new_lines + lines[i:]
    raise RuntimeError(f"closing brace not found for {block_name}")


base = "frontend/src/lib/locales"
for loc in LOCALES:
    path = os.path.join(base, loc, "index.ts")
    with io.open(path, "r", encoding="utf-8") as f:
        text = f.read()
    if "templateCat: {" in text:
        print(f"skip {loc} (already present)")
        continue
    lines = text.split("\n")
    lines = insert_into_block(lines, "agents", build_lines(loc))
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))
    print(f"ok {loc}")
