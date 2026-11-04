#!/opt/drive-uploader/bin/python
"""Upload a completed CyberSWE task ZIP to a dedicated Google Drive folder."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path)
    parser.add_argument("--name", help="Drive filename; defaults to the local filename")
    args = parser.parse_args()

    archive = args.archive.resolve()
    if not archive.is_file():
        raise SystemExit(f"task archive does not exist: {archive}")

    credentials_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    folder_id = os.environ.get("GOOGLE_DRIVE_FOLDER_ID")
    if not credentials_path:
        raise SystemExit("GOOGLE_APPLICATION_CREDENTIALS is not set")
    if not folder_id:
        raise SystemExit("GOOGLE_DRIVE_FOLDER_ID is not set")

    credentials = service_account.Credentials.from_service_account_file(
        credentials_path,
        scopes=["https://www.googleapis.com/auth/drive"],
    )
    drive = build("drive", "v3", credentials=credentials, cache_discovery=False)
    media = MediaFileUpload(str(archive), mimetype="application/zip", resumable=True)
    result = (
        drive.files()
        .create(
            body={"name": args.name or archive.name, "parents": [folder_id]},
            media_body=media,
            fields="id,name,webViewLink",
            supportsAllDrives=True,
        )
        .execute()
    )
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
