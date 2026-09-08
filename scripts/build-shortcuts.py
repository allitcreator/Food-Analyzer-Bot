#!/usr/bin/env python3
"""
Собирает готовые к импорту шорткаты iOS для быстрой записи еды (POST /api/quick).

Зачем генератор, а не «собрал руками и выложил файл»: .shortcut — это plist,
руками его не поправишь, а контракт эндпоинта будет меняться. Здесь описание
шортката живёт как код, пересобрать — одна команда.

    python3 scripts/build-shortcuts.py
    # затем подписать (иначе iOS откажется импортировать):
    shortcuts sign -m anyone -i shortcuts/eda-text.unsigned.shortcut \
                              -o shortcuts/Еда-текст.shortcut

Токен НЕ зашивается: в заголовке остаётся плейсхолдер, который пользователь
меняет после импорта (значение берётся из команды /quick в боте).

Формат plist подсмотрен в экспорте приложения «Команды»: каждое действие —
словарь с WFWorkflowActionIdentifier и WFWorkflowActionParameters; ссылка на
результат предыдущего действия — «магическая переменная», то есть строка из
одного символа U+FFFC плюс attachmentsByRange с UUID нужного действия.
"""
from __future__ import annotations  # системный python3 на маке — 3.9, без него падают аннотации

import plistlib
import uuid
from pathlib import Path

ENDPOINT = "https://alxforbot.online/api/quick"
# Только токен, без слова Bearer: его подставляет заголовок. Двойной «Bearer
# Bearer …» — самая частая ошибка при вставке вручную, и так она невозможна.
TOKEN_PLACEHOLDER = "ВСТАВЬ_ТОКЕН_ИЗ_КОМАНДЫ_QUICK"

TOKEN_QUESTION = "Вставь токен быстрой записи (команда /quick в боте)"

OUT_DIR = Path(__file__).resolve().parent.parent / "shortcuts"

# U+FFFC OBJECT REPLACEMENT CHARACTER — место, куда подставляется переменная.
OBJ = "￼"


def new_uuid() -> str:
    return str(uuid.uuid4()).upper()


def text_value(string: str) -> dict:
    """Обычная текстовая строка в поле действия."""
    return {
        "Value": {"string": string},
        "WFSerializationType": "WFTextTokenString",
    }


def variable_value(output_uuid: str, output_name: str) -> dict:
    """Ссылка на результат предыдущего действия (магическая переменная)."""
    return {
        "Value": {
            "string": OBJ,
            "attachmentsByRange": {
                "{0, 1}": {
                    "Type": "ActionOutput",
                    "OutputUUID": output_uuid,
                    "OutputName": output_name,
                }
            },
        },
        "WFSerializationType": "WFTextTokenString",
    }


def attachment_value(output_uuid: str, output_name: str) -> dict:
    """Явный вход действия — ссылка на результат конкретного предыдущего действия.

    Отличается от variable_value: там переменная подставляется ВНУТРЬ текста
    (WFTextTokenString + attachmentsByRange), здесь всё поле целиком и есть
    ссылка (WFTextTokenAttachment). Для WFInput нужен именно второй вид.

    Зачем вообще задавать вход явно: по умолчанию действие берёт результат
    предыдущего неявно, и эта цепочка рвётся молча — Shortcuts подставляет
    пустоту вместо ошибки. Так фото-ветка и отправляла пустой imageBase64.
    """
    return {
        "Value": {
            "Type": "ActionOutput",
            "OutputUUID": output_uuid,
            "OutputName": output_name,
        },
        "WFSerializationType": "WFTextTokenAttachment",
    }


def dict_field(items: list[tuple[str, dict]]) -> dict:
    """Словарь «ключ → значение» в том виде, в каком его хранят заголовки и JSON-тело."""
    return {
        "Value": {
            "WFDictionaryFieldValueItems": [
                {
                    "WFItemType": 0,  # 0 = текстовое значение
                    "WFKey": text_value(key),
                    "WFValue": value,
                }
                for key, value in items
            ]
        },
        "WFSerializationType": "WFDictionaryFieldValue",
    }


def action(identifier: str, params: dict | None = None) -> dict:
    return {
        "WFWorkflowActionIdentifier": identifier,
        "WFWorkflowActionParameters": params or {},
    }


def comment(text: str) -> dict:
    return action("is.workflow.actions.comment", {"WFCommentActionText": text})


def ask(prompt: str, uuid_: str) -> dict:
    return action(
        "is.workflow.actions.ask",
        {
            "WFAskActionPrompt": prompt,
            "WFInputType": "Text",
            "UUID": uuid_,
            "CustomOutputName": "Ввод",
        },
    )


def dictate(uuid_: str) -> dict:
    """Диктовка вслух: сразу открывает распознавание речи, без клавиатуры."""
    return action(
        "is.workflow.actions.dictatetext",
        {
            "WFSpeechLanguage": "ru-RU",
            "WFDictateTextStopListening": "After Pause",
            "UUID": uuid_,
            "CustomOutputName": "Продиктованное",
        },
    )


def mixed_value(prefix: str, output_uuid: str, output_name: str) -> dict:
    """Текст с переменной внутри: «Символов: <результат действия>».

    Диапазон в attachmentsByRange считается в символах UTF-16, поэтому
    переменную ставим в конец строки — так позиция равна длине префикса.
    """
    return {
        "Value": {
            "string": prefix + OBJ,
            "attachmentsByRange": {
                f"{{{len(prefix)}, 1}}": {
                    "Type": "ActionOutput",
                    "OutputUUID": output_uuid,
                    "OutputName": output_name,
                }
            },
        },
        "WFSerializationType": "WFTextTokenString",
    }


def mixed_text(parts: list) -> dict:
    """Строка из кусков текста и переменных: ["a=", (uuid, "Имя"), " b=", ...].

    Позиции в attachmentsByRange считаются в code units UTF-16, поэтому текст
    в диагностике держим латиницей — так длина куска равна числу символов.
    """
    string = ""
    attachments = {}
    for part in parts:
        if isinstance(part, tuple):
            output_uuid, output_name = part
            attachments[f"{{{len(string)}, 1}}"] = {
                "Type": "ActionOutput",
                "OutputUUID": output_uuid,
                "OutputName": output_name,
            }
            string += OBJ
        else:
            string += part
    return {
        "Value": {"string": string, "attachmentsByRange": attachments},
        "WFSerializationType": "WFTextTokenString",
    }


def token_text(uuid_: str) -> dict:
    """Действие «Текст» с токеном — единственное место, куда его надо вписать.

    Заголовок Authorization собирается из этого действия переменной, а сюда
    значение попадает вопросом при импорте (WFWorkflowImportQuestions). Так
    пользователю не нужно искать заголовок внутри «Получить содержимое URL»:
    iOS спросит токен сама, при установке.
    """
    return action(
        "is.workflow.actions.gettext",
        {
            "WFTextActionText": text_value(TOKEN_PLACEHOLDER),
            "UUID": uuid_,
            "CustomOutputName": "Токен",
        },
    )


def post(json_items: list[tuple[str, dict]], token_uuid: str, uuid_: str | None = None) -> dict:
    params = {
        "WFURL": ENDPOINT,
        "WFHTTPMethod": "POST",
        "WFHTTPBodyType": "JSON",
        "ShowHeaders": True,
        # «Bearer » + переменная: сам токен живёт в действии «Текст» выше.
        "WFHTTPHeaders": dict_field([
            ("Authorization", mixed_value("Bearer ", token_uuid, "Токен")),
        ]),
        "WFJSONValues": dict_field(json_items),
    }
    if uuid_:
        params["UUID"] = uuid_
        params["CustomOutputName"] = "Ответ"
    return action("is.workflow.actions.downloadurl", params)


def post_file(file_input: dict, url_value: dict, token_uuid: str) -> dict:
    """Снимок уходит телом запроса как файл — без base64.

    Тело типа File шлёт байты как есть: из шортката исчезает единственная
    гигантская строка, на которой всё и ломалось. Подпись в тело уже не
    положить, поэтому она едет в query — отсюда url_value вместо простого
    адреса.
    """
    return action(
        "is.workflow.actions.downloadurl",
        {
            "WFURL": url_value,
            "WFHTTPMethod": "POST",
            "WFHTTPBodyType": "File",
            "WFRequestVariable": file_input,
            "ShowHeaders": True,
            "WFHTTPHeaders": dict_field([
                ("Authorization", mixed_value("Bearer ", token_uuid, "Токен")),
            ]),
        },
    )


def count_chars(uuid_: str, input_: dict, name: str = "Символов") -> dict:
    return action(
        "is.workflow.actions.count",
        {"WFCountType": "Characters", "WFInput": input_, "UUID": uuid_, "CustomOutputName": name},
    )


def show_result(value: dict) -> dict:
    return action("is.workflow.actions.showresult", {"Text": value})


def notify(body: str) -> dict:
    return action(
        "is.workflow.actions.notification",
        {"WFNotificationActionBody": body, "WFNotificationActionSound": False},
    )


def take_photo(uuid_: str) -> dict:
    return action(
        "is.workflow.actions.takephoto",
        {"UUID": uuid_, "CustomOutputName": "Снимок"},
    )


def resize(width: int, uuid_: str, input_: dict) -> dict:
    # Ширина строкой, а не числом: в plist «Команд» числовые поля хранятся как
    # строки, и сырой integer приложение молча не читает — ширина становится
    # «Auto». Высоту не задаём намеренно, она считается по пропорции.
    return action(
        "is.workflow.actions.image.resize",
        {
            "WFImageResizeWidth": str(width),
            "WFInput": input_,
            "UUID": uuid_,
            "CustomOutputName": "Уменьшенное",
        },
    )


def to_jpeg(uuid_: str, input_: dict) -> dict:
    return action(
        "is.workflow.actions.image.convert",
        {
            "WFImageFormat": "JPEG",
            "WFImageCompressionQuality": "0.7",
            "WFInput": input_,
            "UUID": uuid_,
            "CustomOutputName": "JPEG",
        },
    )


def base64_encode(uuid_: str, input_: dict) -> dict:
    # Разрывы строк оставляем как есть: сервер вычищает пробельные символы сам
    # (shared/routes.ts, quickSchema), а лишняя настройка — лишний способ
    # сломать сценарий.
    return action(
        "is.workflow.actions.base64encode",
        {
            "WFEncodeMode": "Encode",
            "WFInput": input_,
            "UUID": uuid_,
            "CustomOutputName": "Base64",
        },
    )


def menu_start(prompt: str, items: list[str], group: str) -> dict:
    return action(
        "is.workflow.actions.choosefrommenu",
        {
            "WFControlFlowMode": 0,
            "WFMenuPrompt": prompt,
            "WFMenuItems": items,
            "GroupingIdentifier": group,
        },
    )


def menu_item(title: str, group: str) -> dict:
    return action(
        "is.workflow.actions.choosefrommenu",
        {"WFControlFlowMode": 1, "WFMenuItemTitle": title, "GroupingIdentifier": group},
    )


def menu_end(group: str) -> dict:
    return action(
        "is.workflow.actions.choosefrommenu",
        {"WFControlFlowMode": 2, "GroupingIdentifier": group},
    )


HEADER_HINT = (
    "БЫСТРАЯ ЗАПИСЬ ЕДЫ\n\n"
    "Токен спрашивается один раз при импорте и попадает в действие «Текст» "
    "сразу под этим комментарием. Если промахнулся — поменяй его там, лезть в "
    "заголовки не нужно.\n\n"
    "Токен берётся из команды /quick в боте.\n\n"
    "Карточка подтверждения с КБЖУ придёт в Telegram через несколько секунд."
)


def import_questions(actions: list[dict], token_uuid: str) -> list[dict]:
    """Вопрос, который iOS задаёт при импорте, и сама подставляет ответ.

    ActionIndex — позиция действия в массиве, поэтому вычисляем её, а не
    хардкодим: порядок действий меняется при любой правке сценария.
    """
    index = next(
        i for i, act in enumerate(actions)
        if act["WFWorkflowActionParameters"].get("UUID") == token_uuid
    )
    return [{
        "ActionIndex": index,
        "Category": "Parameter",
        "ParameterKey": "WFTextActionText",
        "Text": TOKEN_QUESTION,
    }]


def workflow(actions: list[dict], questions: list[dict] | None = None) -> dict:
    return {
        "WFWorkflowClientVersion": "2607.0.3",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {
            "WFWorkflowIconStartColor": 4274264319,
            "WFWorkflowIconGlyphNumber": 61440,
        },
        "WFWorkflowImportQuestions": questions or [],
        "WFWorkflowTypes": [],
        "WFWorkflowInputContentItemClasses": [],
        "WFWorkflowActions": actions,
    }


def build_text_only() -> dict:
    ask_uuid, token_uuid = new_uuid(), new_uuid()
    actions = [
        comment(HEADER_HINT),
        token_text(token_uuid),
        ask("Что съел?", ask_uuid),
        post([("text", variable_value(ask_uuid, "Ввод"))], token_uuid),
        notify("Отправил на разбор"),
    ]
    return workflow(actions, import_questions(actions, token_uuid))


def build_full() -> dict:
    group = new_uuid()
    dictate_uuid = new_uuid()
    ask_uuid = new_uuid()
    photo_uuid, b64_uuid = new_uuid(), new_uuid()
    caption_uuid, token_uuid = new_uuid(), new_uuid()

    # Три отдельных пункта, а не два: «Запросить ввод» открывает клавиатуру —
    # микрофон на ней есть, но это лишний тап и не то, чего ждёшь от кнопки
    # «Сказать». Диктовка вынесена в свой пункт и стартует сразу.
    actions = [
        comment(HEADER_HINT),
        token_text(token_uuid),
        menu_start(
            "Что записываем?",
            ["🎤 Сказать", "⌨️ Написать", "📷 Сфотографировать"],
            group,
        ),

        menu_item("🎤 Сказать", group),
        dictate(dictate_uuid),
        post([("text", variable_value(dictate_uuid, "Продиктованное"))], token_uuid),
        notify("Отправил на разбор"),

        menu_item("⌨️ Написать", group),
        ask("Что съел?", ask_uuid),
        post([("text", variable_value(ask_uuid, "Ввод"))], token_uuid),
        notify("Отправил на разбор"),

        menu_item("📷 Сфотографировать", group),
        take_photo(photo_uuid),
        ask("Уточнить? Можно оставить пустым", caption_uuid),
        # Снимок уходит как есть, без уменьшения и конвертации. Камера
        # работает и кадр делается, но до сервера он не доезжал ни разу —
        # значит теряется на обработке или на ссылке между действиями. Здесь
        # между съёмкой и отправкой не осталось ничего, что можно потерять.
        # Размер: полный кадр 3–5 МБ, поэтому nginx поднят до 8m.
        # Подпись подставляется прямо в адрес. Промежуточные действия отсюда
        # убраны намеренно: «URL-кодировать» возвращало пустоту, а сборка
        # адреса в отдельном действии ломала отправку совсем — поле URL
        # ссылку на другое действие не принимает. Кодирование Shortcuts
        # делает сам при запросе.
        post_file(
            attachment_value(photo_uuid, "Снимок"),
            mixed_text([ENDPOINT + "?text=", (caption_uuid, "Ввод")]),
            token_uuid,
        ),
        notify("Отправил на разбор"),

        menu_end(group),
    ]
    return workflow(actions, import_questions(actions, token_uuid))


DIAG_HINT = (
    "ДИАГНОСТИКА ФОТО-ВЕТКИ\n\n"
    "Кодирует один и тот же снимок в base64 двумя способами и показывает две "
    "длины. Ничего никуда не отправляет, токен не нужен.\n\n"
    "impl — вход действия берётся неявно, от предыдущего действия. "
    "expl — вход задан явной ссылкой на снимок.\n\n"
    "Если impl больше нуля, а expl равен нулю, значит ссылки на результат "
    "записаны неверно, и чинить нужно их. Если оба нуля — теряется сам снимок."
)


def build_diag() -> dict:
    """Какой способ передачи входа работает — неявный или явный.

    Прошлый замер дал три нуля подряд, а по документации и действия, и их
    параметры заданы верно. Значит подозрение переходит на то, чем эти
    действия связаны между собой: либо снимок не доезжает вовсе, либо
    WFInput-ссылка не разрешается и обнуляет всё, что за ней.

    Оба base64 кодируют ОДИН снимок, поэтому длины должны совпасть. Любое
    расхождение — это и есть ответ.
    """
    photo_uuid = new_uuid()
    b64_impl, n_impl = new_uuid(), new_uuid()
    b64_expl, n_expl = new_uuid(), new_uuid()

    return workflow([
        comment(DIAG_HINT),
        take_photo(photo_uuid),

        # Неявная цепочка: действие берёт результат предыдущего само.
        action("is.workflow.actions.base64encode",
               {"WFEncodeMode": "Encode", "UUID": b64_impl, "CustomOutputName": "Base64impl"}),
        action("is.workflow.actions.count",
               {"WFCountType": "Characters", "UUID": n_impl, "CustomOutputName": "Impl"}),

        # Явная ссылка на тот же снимок.
        base64_encode(b64_expl, attachment_value(photo_uuid, "Снимок")),
        count_chars(n_expl, attachment_value(b64_expl, "Base64"), "Expl"),

        show_result(mixed_text([
            "impl=", (n_impl, "Impl"),
            " expl=", (n_expl, "Expl"),
        ])),
    ])


def collect_output_refs(node: object) -> list[str]:
    """Все OutputUUID, на которые ссылается поддерево параметров."""
    found: list[str] = []
    if isinstance(node, dict):
        if node.get("Type") == "ActionOutput" and "OutputUUID" in node:
            found.append(node["OutputUUID"])
        for value in node.values():
            found.extend(collect_output_refs(value))
    elif isinstance(node, list):
        for item in node:
            found.extend(collect_output_refs(item))
    return found


# Действия, которые обязаны получать вход явно: они стоят в фото-ветке, где
# неявная цепочка однажды уже порвалась и отправила пустой imageBase64.
NEEDS_EXPLICIT_INPUT = {
    "is.workflow.actions.image.resize",
    "is.workflow.actions.image.convert",
    "is.workflow.actions.base64encode",
}


def validate(name: str, wf: dict, strict_inputs: bool = True) -> None:
    """Проверить собранный шорткат до подписи — на телефоне ошибка молчаливая.

    Shortcuts не жалуется на битую ссылку и не падает: подставляет пустую
    строку и идёт дальше. Поэтому целостность ссылок проверяем здесь, а не
    распаковкой подписанного файла руками.
    """
    seen: set[str] = set()
    problems: list[str] = []

    for index, act in enumerate(wf["WFWorkflowActions"]):
        identifier = act["WFWorkflowActionIdentifier"]
        params = act["WFWorkflowActionParameters"]

        for ref in collect_output_refs(params):
            if ref not in seen:
                problems.append(f"действие {index} ({identifier}) ссылается на неизвестный выход {ref}")

        if strict_inputs and identifier in NEEDS_EXPLICIT_INPUT and "WFInput" not in params:
            problems.append(f"действие {index} ({identifier}) без явного WFInput")

        for key in ("WFImageResizeWidth", "WFImageResizeHeight", "WFImageCompressionQuality"):
            if key in params and not isinstance(params[key], str):
                problems.append(f"действие {index} ({identifier}): {key} должно быть строкой, а не {type(params[key]).__name__}")

        if "UUID" in params:
            seen.add(params["UUID"])

    # Вопрос при импорте: битый ActionIndex молча ничего не спросит, и человек
    # получит шорткат с плейсхолдером вместо токена.
    actions = wf["WFWorkflowActions"]
    for q in wf.get("WFWorkflowImportQuestions", []):
        index = q["ActionIndex"]
        if not 0 <= index < len(actions):
            problems.append(f"вопрос импорта указывает на действие {index}, которого нет")
            continue
        if q["ParameterKey"] not in actions[index]["WFWorkflowActionParameters"]:
            problems.append(
                f"вопрос импорта: у действия {index} нет параметра {q['ParameterKey']}"
            )

    if problems:
        raise SystemExit(f"{name}: " + "; ".join(problems))


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    for name, wf in (("eda-text", build_text_only()), ("eda-full", build_full()), ("eda-diag", build_diag())):
        # В диагностике отсутствие WFInput — часть эксперимента, а не ошибка.
        validate(name, wf, strict_inputs=name != "eda-diag")
        path = OUT_DIR / f"{name}.unsigned.shortcut"
        with path.open("wb") as fh:
            plistlib.dump(wf, fh, fmt=plistlib.FMT_BINARY)
        print(f"написан {path}")


if __name__ == "__main__":
    main()
