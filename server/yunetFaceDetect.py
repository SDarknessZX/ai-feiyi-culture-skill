from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import cv2 as cv

RESULT_PREFIX = "FACE_DETECT_RESULT="


def detect_faces(
    image_path: str,
    model_path: str,
    score_threshold: float,
    nms_threshold: float,
    top_k: int,
) -> list[list[int]]:
    image = cv.imread(image_path)
    if image is None:
        raise RuntimeError("无法读取上传图片。")

    model = Path(model_path)
    if not model.is_file():
        raise RuntimeError(f"YuNet 模型文件不存在：{model}")

    height, width = image.shape[:2]
    detector = cv.FaceDetectorYN.create(
        model=str(model),
        config="",
        input_size=(width, height),
        score_threshold=score_threshold,
        nms_threshold=nms_threshold,
        top_k=top_k,
        backend_id=cv.dnn.DNN_BACKEND_OPENCV,
        target_id=cv.dnn.DNN_TARGET_CPU,
    )
    detector.setInputSize((width, height))
    _, faces = detector.detect(image)
    if faces is None:
        return []

    boxes: list[list[int]] = []
    for face in faces:
        x, y, box_width, box_height = face[:4]
        boxes.append(
            [
                max(0, int(round(float(x)))),
                max(0, int(round(float(y)))),
                max(1, int(round(float(box_width)))),
                max(1, int(round(float(box_height)))),
            ]
        )
    return boxes


def main() -> None:
    parser = argparse.ArgumentParser(description="Detect faces in one image with OpenCV YuNet.")
    parser.add_argument("--image-path", required=True)
    parser.add_argument(
        "--model-path",
        default=os.getenv(
            "FACE_DETECT_MODEL_PATH",
            str(Path(__file__).resolve().parent / "models" / "face_detection_yunet_2023mar.onnx"),
        ),
    )
    parser.add_argument(
        "--score-threshold",
        type=float,
        # 0.8 对黑白、柔光和低对比度人像容易漏检；0.65 在保留人脸门槛的同时提高召回率。
        default=float(os.getenv("FACE_DETECT_SCORE_THRESHOLD", "0.65")),
    )
    parser.add_argument(
        "--nms-threshold",
        type=float,
        default=float(os.getenv("FACE_DETECT_NMS_THRESHOLD", "0.3")),
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=int(os.getenv("FACE_DETECT_TOP_K", "5000")),
    )
    args = parser.parse_args()

    boxes = detect_faces(
        image_path=args.image_path,
        model_path=args.model_path,
        score_threshold=args.score_threshold,
        nms_threshold=args.nms_threshold,
        top_k=args.top_k,
    )
    print(
        f"{RESULT_PREFIX}"
        + json.dumps(
            {
                "hasFace": len(boxes) > 0,
                "faceBoundingBoxes": boxes,
            },
            ensure_ascii=False,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
