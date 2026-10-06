# One-off (PDR-004 batches 4-5): append parallel/synthesis keys to the chat
# block of all 14 locales. Same insertion routine as add_agents_i18n.py.
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
        "parallelSend",
        {
            "zh-CN": "并发问答",
            "zh-TW": "並行問答",
            "en-US": "Parallel ask",
            "ja-JP": "並列質問",
            "de-DE": "Paralleles Fragen",
            "es-ES": "Pregunta paralela",
            "fr-FR": "Question parallèle",
            "it-IT": "Domanda parallela",
            "pl-PL": "Pytaj równolegle",
            "pt-BR": "Pergunta paralela",
            "ru-RU": "Параллельный вопрос",
            "tr-TR": "Paralel soru",
            "ca-ES": "Pregunta en paral·lel",
            "bn-IN": "সমান্তরাল প্রশ্ন",
        },
    ),
    (
        "parallelPickTitle",
        {
            "zh-CN": "选择并发参与者",
            "zh-TW": "選擇並行參與者",
            "en-US": "Pick parallel participants",
            "ja-JP": "並列参加者を選択",
            "de-DE": "Parallele Teilnehmer wählen",
            "es-ES": "Elegir participantes paralelos",
            "fr-FR": "Choisir les participants parallèles",
            "it-IT": "Scegli i partecipanti paralleli",
            "pl-PL": "Wybierz uczestników równoległych",
            "pt-BR": "Escolher participantes paralelos",
            "ru-RU": "Выберите участников параллельного опроса",
            "tr-TR": "Paralel katılımcıları seçin",
            "ca-ES": "Tria els participants en paral·lel",
            "bn-IN": "সমান্তরাল অংশগ্রহণকারী বেছে নিন",
        },
    ),
    (
        "parallelPickCount",
        {
            "zh-CN": "已选 {{count}}/{{max}}",
            "zh-TW": "已選 {{count}}/{{max}}",
            "en-US": "{{count}}/{{max}} picked",
            "ja-JP": "{{count}}/{{max}} 選択中",
            "de-DE": "{{count}}/{{max}} gewählt",
            "es-ES": "{{count}}/{{max}} elegidos",
            "fr-FR": "{{count}}/{{max}} choisis",
            "it-IT": "{{count}}/{{max}} scelti",
            "pl-PL": "wybrano {{count}}/{{max}}",
            "pt-BR": "{{count}}/{{max}} escolhidos",
            "ru-RU": "выбрано {{count}}/{{max}}",
            "tr-TR": "{{count}}/{{max}} seçildi",
            "ca-ES": "{{count}}/{{max}} triats",
            "bn-IN": "{{count}}/{{max}} নির্বাচিত",
        },
    ),
    (
        "parallelPickHint",
        {
            "zh-CN": "可勾选多个，同时提问",
            "zh-TW": "可勾選多個，同時提問",
            "en-US": "Tick several and ask at once",
            "ja-JP": "複数選んで同時に質問できます",
            "de-DE": "Mehrere ankreuzen und gleichzeitig fragen",
            "es-ES": "Marca varios y pregunta a la vez",
            "fr-FR": "Cochez-en plusieurs pour demander d'un coup",
            "it-IT": "Selezionane più d'uno e chiedi insieme",
            "pl-PL": "Zaznacz kilka i zapytaj naraz",
            "pt-BR": "Marque vários e pergunte de uma vez",
            "ru-RU": "Отметьте несколько и спросите разом",
            "tr-TR": "Birkaçını işaretleyip aynı anda sor",
            "ca-ES": "Marca'n diversos i pregunta alhora",
            "bn-IN": "একাধিক নির্বাচন করে একসাথে জিজ্ঞাসা করুন",
        },
    ),
    (
        "parallelMaxReached",
        {
            "zh-CN": "已达 5 个上限",
            "zh-TW": "已達 5 個上限",
            "en-US": "Limit of 5 reached",
            "ja-JP": "上限の5件に達しました",
            "de-DE": "Limit von 5 erreicht",
            "es-ES": "Límite de 5 alcanzado",
            "fr-FR": "Limite de 5 atteinte",
            "it-IT": "Limite di 5 raggiunto",
            "pl-PL": "Osiągnięto limit 5",
            "pt-BR": "Limite de 5 atingido",
            "ru-RU": "Достигнут лимит в 5",
            "tr-TR": "5 sınırına ulaşıldı",
            "ca-ES": "S'ha arribat al límit de 5",
            "bn-IN": "৫টির সীমায় পৌঁছেছে",
        },
    ),
    (
        "parallelConfirm",
        {
            "zh-CN": "并发提问",
            "zh-TW": "並行提問",
            "en-US": "Ask in parallel",
            "ja-JP": "並列で質問",
            "de-DE": "Parallel fragen",
            "es-ES": "Preguntar en paralelo",
            "fr-FR": "Demander en parallèle",
            "it-IT": "Chiedi in parallelo",
            "pl-PL": "Zapytaj równolegle",
            "pt-BR": "Perguntar em paralelo",
            "ru-RU": "Спросить параллельно",
            "tr-TR": "Paralel sor",
            "ca-ES": "Pregunta en paral·lel",
            "bn-IN": "সমান্তরালে জিজ্ঞাসা করুন",
        },
    ),
    (
        "parallelProgress",
        {
            "zh-CN": "并发进行中：{{done}}/{{total}} 完成",
            "zh-TW": "並行進行中：{{done}}/{{total}} 完成",
            "en-US": "Running: {{done}}/{{total}} done",
            "ja-JP": "実行中：{{done}}/{{total}} 完了",
            "de-DE": "Läuft: {{done}}/{{total}} fertig",
            "es-ES": "En curso: {{done}}/{{total}} listos",
            "fr-FR": "En cours : {{done}}/{{total}} terminés",
            "it-IT": "In corso: {{done}}/{{total}} completati",
            "pl-PL": "W toku: ukończono {{done}}/{{total}}",
            "pt-BR": "Em andamento: {{done}}/{{total}} prontos",
            "ru-RU": "Выполняется: {{done}}/{{total}} готово",
            "tr-TR": "Sürüyor: {{done}}/{{total}} tamam",
            "ca-ES": "En curs: {{done}}/{{total}} fets",
            "bn-IN": "চলছে: {{done}}/{{total}} সম্পন্ন",
        },
    ),
    (
        "parallelWaiting",
        {
            "zh-CN": "等待回答…",
            "zh-TW": "等待回答…",
            "en-US": "Waiting for the answer…",
            "ja-JP": "回答を待っています…",
            "de-DE": "Warte auf die Antwort…",
            "es-ES": "Esperando la respuesta…",
            "fr-FR": "En attente de la réponse…",
            "it-IT": "In attesa della risposta…",
            "pl-PL": "Czekam na odpowiedź…",
            "pt-BR": "Aguardando a resposta…",
            "ru-RU": "Ожидание ответа…",
            "tr-TR": "Yanıt bekleniyor…",
            "ca-ES": "Esperant la resposta…",
            "bn-IN": "উত্তরের অপেক্ষায়…",
        },
    ),
    (
        "parallelFailed",
        {
            "zh-CN": "并发问答失败",
            "zh-TW": "並行問答失敗",
            "en-US": "Parallel ask failed",
            "ja-JP": "並列質問に失敗しました",
            "de-DE": "Paralleles Fragen fehlgeschlagen",
            "es-ES": "Falló la pregunta paralela",
            "fr-FR": "Échec de la question parallèle",
            "it-IT": "Domanda parallela non riuscita",
            "pl-PL": "Pytanie równoległe nie powiodło się",
            "pt-BR": "Falha na pergunta paralela",
            "ru-RU": "Параллельный вопрос не удался",
            "tr-TR": "Paralel soru başarısız",
            "ca-ES": "Ha fallat la pregunta en paral·lel",
            "bn-IN": "সমান্তরাল প্রশ্ন ব্যর্থ",
        },
    ),
    (
        "synthesisPickLabel",
        {
            "zh-CN": "总结合并：",
            "zh-TW": "總結合併：",
            "en-US": "Synthesize & merge:",
            "ja-JP": "統合してまとめる：",
            "de-DE": "Zusammenführen mit:",
            "es-ES": "Sintetizar y fusionar:",
            "fr-FR": "Synthétiser et fusionner :",
            "it-IT": "Sintetizza e unisci:",
            "pl-PL": "Zsyntetyzuj i połącz:",
            "pt-BR": "Sintetizar e mesclar:",
            "ru-RU": "Обобщить и объединить:",
            "tr-TR": "Birleştir ve özetle:",
            "ca-ES": "Sintetitza i fusiona:",
            "bn-IN": "সংশ্লেষ করে একীভূত করুন:",
        },
    ),
    (
        "synthesisDefaultPicker",
        {
            "zh-CN": "系统默认模型",
            "zh-TW": "系統預設模型",
            "en-US": "System default model",
            "ja-JP": "システム既定のモデル",
            "de-DE": "Systemstandard-Modell",
            "es-ES": "Modelo predeterminado del sistema",
            "fr-FR": "Modèle par défaut du système",
            "it-IT": "Modello predefinito di sistema",
            "pl-PL": "Domyślny model systemu",
            "pt-BR": "Modelo padrão do sistema",
            "ru-RU": "Системная модель по умолчанию",
            "tr-TR": "Sistem varsayılan modeli",
            "ca-ES": "Model per defecte del sistema",
            "bn-IN": "সিস্টেম ডিফল্ট মডেল",
        },
    ),
    (
        "synthesisRun",
        {
            "zh-CN": "生成总结",
            "zh-TW": "產生總結",
            "en-US": "Synthesize",
            "ja-JP": "まとめを生成",
            "de-DE": "Zusammenfassen",
            "es-ES": "Sintetizar",
            "fr-FR": "Synthétiser",
            "it-IT": "Sintetizza",
            "pl-PL": "Podsumuj",
            "pt-BR": "Sintetizar",
            "ru-RU": "Обобщить",
            "tr-TR": "Özetle",
            "ca-ES": "Sintetitza",
            "bn-IN": "সংশ্লেষ করুন",
        },
    ),
    (
        "synthesisResultTitle",
        {
            "zh-CN": "总结结论",
            "zh-TW": "總結結論",
            "en-US": "Synthesized answer",
            "ja-JP": "統合された回答",
            "de-DE": "Zusammengeführte Antwort",
            "es-ES": "Respuesta sintetizada",
            "fr-FR": "Réponse synthétisée",
            "it-IT": "Risposta sintetizzata",
            "pl-PL": "Odpowiedź zbiorcza",
            "pt-BR": "Resposta sintetizada",
            "ru-RU": "Итоговый ответ",
            "tr-TR": "Birleştirilmiş yanıt",
            "ca-ES": "Resposta sintetitzada",
            "bn-IN": "সংশ্লেষিত উত্তর",
        },
    ),
    (
        "synthesisFailed",
        {
            "zh-CN": "总结生成失败",
            "zh-TW": "總結產生失敗",
            "en-US": "Synthesis failed",
            "ja-JP": "まとめの生成に失敗しました",
            "de-DE": "Zusammenfassung fehlgeschlagen",
            "es-ES": "Falló la síntesis",
            "fr-FR": "Échec de la synthèse",
            "it-IT": "Sintesi non riuscita",
            "pl-PL": "Synteza nie powiodła się",
            "pt-BR": "Falha na síntese",
            "ru-RU": "Обобщение не удалось",
            "tr-TR": "Özetleme başarısız",
            "ca-ES": "Ha fallat la síntesi",
            "bn-IN": "সংশ্লেষণ ব্যর্থ",
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
    if "parallelPickTitle" in text:
        print(f"skip {loc}")
        continue
    lines = text.split("\n")
    new_lines = [f'    {key}: "{esc(table[loc])}",' for key, table in KEYS]
    lines = insert_into_block(lines, "chat", new_lines)
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))
    print(f"ok {loc}")
