# One-off: append parallel-visibility keys (empty-input hint + trigger count)
# to the chat block of all 14 locales. Same insertion routine as
# add_parallel_i18n.py.
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

KEYS = [
    (
        "parallelEmptyHint",
        {
            "zh-CN": "请先输入问题，再发起并发问答",
            "zh-TW": "請先輸入問題，再發起並行問答",
            "en-US": "Type a question first, then start parallel answers",
            "ja-JP": "質問を入力してから並列回答を開始してください",
            "bn-IN": "প্রথমে একটি প্রশ্ন লিখুন, তারপর সমান্তরাল উত্তর শুরু করুন",
            "ca-ES": "Escriviu primer una pregunta i després inicieu les respostes paral·leles",
            "de-DE": "Gib zuerst eine Frage ein, um parallele Antworten zu starten",
            "es-ES": "Escribe primero una pregunta y luego inicia las respuestas paralelas",
            "fr-FR": "Saisissez d'abord une question, puis lancez les réponses parallèles",
            "it-IT": "Scrivi prima una domanda, poi avvia le risposte parallele",
            "pl-PL": "Najpierw wpisz pytanie, a potem uruchom równoległe odpowiedzi",
            "pt-BR": "Digite primeiro uma pergunta e depois inicie as respostas paralelas",
            "ru-RU": "Сначала введите вопрос, затем запустите параллельные ответы",
            "tr-TR": "Önce bir soru yazın, sonra paralel yanıtları başlatın",
        },
    ),
    (
        "parallelTriggerCount",
        {
            "zh-CN": "并发问答 · {{count}}",
            "zh-TW": "並行問答 · {{count}}",
            "en-US": "Parallel · {{count}}",
            "ja-JP": "並列回答 · {{count}}",
            "bn-IN": "সমান্তরাল উত্তর · {{count}}",
            "ca-ES": "Paral·lel · {{count}}",
            "de-DE": "Parallel · {{count}}",
            "es-ES": "Paralelo · {{count}}",
            "fr-FR": "Parallèle · {{count}}",
            "it-IT": "Parallelo · {{count}}",
            "pl-PL": "Równolegle · {{count}}",
            "pt-BR": "Paralelo · {{count}}",
            "ru-RU": "Параллельно · {{count}}",
            "tr-TR": "Paralel · {{count}}",
        },
    ),
]


def esc(t):
    return t.replace("\\", "\\\\").replace('"', '\\"')


def insert_into_block(lines, block_name, new_lines):
    start = next(i for i, ln in enumerate(lines) if ln.strip() == f"{block_name}: {{")
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
    if "parallelEmptyHint" in text:
        print(f"skip {loc}")
        continue
    lines = text.split("\n")
    new_lines = [f'    {key}: "{esc(table[loc])}",' for key, table in KEYS]
    lines = insert_into_block(lines, "chat", new_lines)
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))
    print(f"ok {loc}")
