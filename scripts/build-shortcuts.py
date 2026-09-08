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
TOKEN_PLACEHOLDER = "Bearer ВСТАВЬ_СЮДА_ТОКЕН_ИЗ_КОМАНДЫ_QUICK"

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


def post(json_items: list[tuple[str, dict]], uuid_: str | None = None) -> dict:
    params = {
        "WFURL": ENDPOINT,
        "WFHTTPMethod": "POST",
        "WFHTTPBodyType": "JSON",
        "ShowHeaders": True,
        "WFHTTPHeaders": dict_field([("Authorization", text_value(TOKEN_PLACEHOLDER))]),
        "WFJSONValues": dict_field(json_items),
    }
    if uuid_:
        params["UUID"] = uuid_
        params["CustomOutputName"] = "Ответ"
    return action("is.workflow.actions.downloadurl", params)


def count_chars(uuid_: str) -> dict:
    return action(
        "is.workflow.actions.count",
        {"WFCountType": "Characters", "UUID": uuid_, "CustomOutputName": "Символов"},
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
        {"WFCameraCaptureShowPreview": True, "UUID": uuid_, "CustomOutputName": "Снимок"},
    )


def resize(width: int, uuid_: str) -> dict:
    return action(
        "is.workflow.actions.image.resize",
        {"WFImageResizeWidth": width, "UUID": uuid_, "CustomOutputName": "Уменьшенное"},
    )


def to_jpeg(uuid_: str) -> dict:
    return action(
        "is.workflow.actions.image.convert",
        {
            "WFImageFormat": "JPEG",
            "WFImageCompressionQuality": 0.7,
            "UUID": uuid_,
            "CustomOutputName": "JPEG",
        },
    )


def base64_encode(uuid_: str) -> dict:
    # Разрывы строк оставляем как есть: сервер вычищает пробельные символы сам
    # (shared/routes.ts, quickSchema), а лишняя настройка — лишний способ
    # сломать сценарий.
    return action(
        "is.workflow.actions.base64encode",
        {"WFEncodeMode": "Encode", "UUID": uuid_, "CustomOutputName": "Base64"},
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
    "Перед первым запуском: открой действие «Получить содержимое URL» ниже, "
    "найди заголовок Authorization и замени текст после слова Bearer на свой токен "
    "из команды /quick в боте.\n\n"
    "Карточка подтверждения с КБЖУ придёт в Telegram через несколько секунд."
)


def workflow(actions: list[dict]) -> dict:
    return {
        "WFWorkflowClientVersion": "2607.0.3",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {
            "WFWorkflowIconStartColor": 4274264319,
            "WFWorkflowIconGlyphNumber": 61440,
        },
        "WFWorkflowImportQuestions": [],
        "WFWorkflowTypes": [],
        "WFWorkflowInputContentItemClasses": [],
        "WFWorkflowActions": actions,
    }


def build_text_only() -> dict:
    ask_uuid = new_uuid()
    return workflow([
        comment(HEADER_HINT),
        ask("Что съел?", ask_uuid),
        post([("text", variable_value(ask_uuid, "Ввод"))]),
        notify("Отправил на разбор"),
    ])


def build_full() -> dict:
    group = new_uuid()
    dictate_uuid = new_uuid()
    ask_uuid = new_uuid()
    photo_uuid, resized_uuid, jpeg_uuid, b64_uuid = (new_uuid() for _ in range(4))
    caption_uuid = new_uuid()

    # Три отдельных пункта, а не два: «Запросить ввод» открывает клавиатуру —
    # микрофон на ней есть, но это лишний тап и не то, чего ждёшь от кнопки
    # «Сказать». Диктовка вынесена в свой пункт и стартует сразу.
    return workflow([
        comment(HEADER_HINT),
        menu_start(
            "Что записываем?",
            ["🎤 Сказать", "⌨️ Написать", "📷 Сфотографировать"],
            group,
        ),

        menu_item("🎤 Сказать", group),
        dictate(dictate_uuid),
        post([("text", variable_value(dictate_uuid, "Продиктованное"))]),
        notify("Отправил на разбор"),

        menu_item("⌨️ Написать", group),
        ask("Что съел?", ask_uuid),
        post([("text", variable_value(ask_uuid, "Ввод"))]),
        notify("Отправил на разбор"),

        menu_item("📷 Сфотографировать", group),
        take_photo(photo_uuid),
        resize(1280, resized_uuid),
        to_jpeg(jpeg_uuid),
        base64_encode(b64_uuid),
        ask("Уточнить? Можно оставить пустым", caption_uuid),
        post([
            ("imageBase64", variable_value(b64_uuid, "Base64")),
            ("text", variable_value(caption_uuid, "Ввод")),
        ]),
        notify("Отправил на разбор"),

        menu_end(group),
    ])


DIAG_HINT = (
    "ДИАГНОСТИКА ФОТО-ВЕТКИ\n\n"
    "Тот же путь, что и в основном шорткате, но с двумя остановками: сначала "
    "показывает, сколько символов base64 получилось после сжатия, потом — что "
    "ответил сервер.\n\n"
    "Ориентир: фото 1280 px с качеством 0.7 — это примерно 300–600 тысяч "
    "символов. Несколько миллионов означают, что сжатие не сработало и тело "
    "запроса режется по дороге.\n\n"
    "Токен подставь в заголовок Authorization, как в основном шорткате."
)


def build_diag() -> dict:
    """Фото-ветка с показом размера и ответа сервера — чтобы не гадать по симптому.

    Уведомление «Отправил на разбор» в основном шорткате приходит всегда:
    действие «Получить содержимое URL» на 4xx не прерывает выполнение, а молча
    отдаёт тело ответа. Здесь тело показывается на экран.
    """
    photo_uuid, resized_uuid, jpeg_uuid, b64_uuid = (new_uuid() for _ in range(4))
    count_uuid, post_uuid = new_uuid(), new_uuid()

    return workflow([
        comment(DIAG_HINT),
        take_photo(photo_uuid),
        resize(1280, resized_uuid),
        to_jpeg(jpeg_uuid),
        base64_encode(b64_uuid),
        count_chars(count_uuid),
        show_result(mixed_value("Символов base64: ", count_uuid, "Символов")),
        post([("imageBase64", variable_value(b64_uuid, "Base64"))], post_uuid),
        show_result(mixed_value("Ответ сервера: ", post_uuid, "Ответ")),
    ])


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    for name, wf in (("eda-text", build_text_only()), ("eda-full", build_full()), ("eda-diag", build_diag())):
        path = OUT_DIR / f"{name}.unsigned.shortcut"
        with path.open("wb") as fh:
            plistlib.dump(wf, fh, fmt=plistlib.FMT_BINARY)
        print(f"написан {path}")


if __name__ == "__main__":
    main()
