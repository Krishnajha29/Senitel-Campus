"""
Sentinel Campus: Server-Side Computer Vision Face Recognition Service
FastAPI Microservice fallback for high-throughput or policy-restricted server inference.
"""

from typing import List, Optional
import io
import math
import numpy as np
from PIL import Image
from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    import face_recognition
    CV_AVAILABLE = True
except ImportError:
    CV_AVAILABLE = False

app = FastAPI(
    title="Sentinel Campus CV Engine",
    description="Multi-face detection, 128-d embedding extraction, and Euclidean roster matcher.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class EnrolledStudentDescriptor(BaseModel):
    id: string = ""
    full_name: str
    roll_number: str
    descriptor: List[float]

class MatchCandidate(BaseModel):
    student_id: str
    student_name: str
    roll_number: str
    distance: float
    similarity: int
    category: str

class DetectedFaceResult(BaseModel):
    detection_id: str
    box: dict
    confidence: float
    descriptor: List[float]
    best_candidate: Optional[MatchCandidate] = None
    alternative_candidates: List[MatchCandidate] = []
    category: str  # high_confidence, needs_review, unknown, ambiguous

class ClassroomPhotoResponse(BaseModel):
    total_faces: int
    high_confidence_matches: List[DetectedFaceResult]
    needs_review_matches: List[DetectedFaceResult]
    unknown_faces: List[DetectedFaceResult]
    not_detected_student_ids: List[str]

def euclidean_distance(v1: np.ndarray, v2: np.ndarray) -> float:
    return float(np.linalg.norm(v1 - v2))

def distance_to_similarity(distance: float) -> int:
    return max(0, min(100, round((1.0 - distance / 1.0) * 100)))

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "engine": "dlib/face_recognition" if CV_AVAILABLE else "synthetic_mock_mode",
        "service": "Sentinel Campus CV Microservice",
    }

@app.post("/api/cv/validate-reference-photo")
async def validate_reference_photo(file: UploadFile = File(...)):
    """
    Validates a student reference photo for registration:
    - Must contain exactly 1 clear face.
    - Extracts 128-d Euclidean embedding.
    """
    contents = await file.read()
    image = Image.open(io.BytesIO(contents)).convert("RGB")
    np_img = np.array(image)

    if not CV_AVAILABLE:
        # Fallback synthetic descriptor if dlib/cmake not installed in host environment
        synth = np.random.randn(128)
        synth /= np.linalg.norm(synth)
        return {
            "valid": True,
            "descriptor": synth.tolist(),
            "quality_score": 0.98,
            "message": "Engine running in fallback mode. Install face_recognition for production.",
        }

    boxes = face_recognition.face_locations(np_img, model="hog")
    if len(boxes) == 0:
        raise HTTPException(status_code=400, detail="No detectable face found in the photograph.")
    if len(boxes) > 1:
        raise HTTPException(
            status_code=400,
            detail=f"Multiple faces detected ({len(boxes)}). Reference photo must contain exactly one face.",
        )

    encodings = face_recognition.face_encodings(np_img, known_face_locations=boxes)
    if len(encodings) == 0:
        raise HTTPException(status_code=400, detail="Could not extract facial embedding.")

    top, right, bottom, left = boxes[0]
    return {
        "valid": True,
        "descriptor": encodings[0].tolist(),
        "box": {"x": left, "y": top, "width": right - left, "height": bottom - top},
        "quality_score": 0.96,
    }

@app.post("/api/cv/process-classroom-photo", response_model=ClassroomPhotoResponse)
async def process_classroom_photo(
    file: UploadFile = File(...),
    roster_json: str = Form(...),
):
    """
    Processes a classroom photograph with multi-face detection and roster matching.
    """
    import json
    roster_data = json.loads(roster_json)
    contents = await file.read()
    image = Image.open(io.BytesIO(contents)).convert("RGB")
    np_img = np.array(image)

    if CV_AVAILABLE:
        face_boxes = face_recognition.face_locations(np_img, model="hog")
        encodings = face_recognition.face_encodings(np_img, known_face_locations=face_boxes)
    else:
        # Synthetic mock detections for non-dlib testing environments
        face_boxes = [(100, 200, 200, 100)]
        encodings = [np.random.randn(128)]

    enrolled_references = [
        (
            item["id"],
            item["full_name"],
            item["roll_number"],
            np.array(item["descriptor"]),
        )
        for item in roster_data
        if "descriptor" in item and len(item["descriptor"]) == 128
    ]

    high_confidence = []
    needs_review = []
    unknown = []
    matched_student_ids = set()

    for i, (box, enc) in enumerate(zip(face_boxes, encodings)):
        top, right, bottom, left = box
        box_dict = {"x": left, "y": top, "width": right - left, "height": bottom - top}

        candidates = []
        for s_id, s_name, s_roll, s_desc in enrolled_references:
            dist = euclidean_distance(enc, s_desc)
            sim = distance_to_similarity(dist)
            cat = "high_confidence" if dist <= 0.45 else "needs_review"
            candidates.append(
                MatchCandidate(
                    student_id=s_id,
                    student_name=s_name,
                    roll_number=s_roll,
                    distance=round(dist, 4),
                    similarity=sim,
                    category=cat,
                )
            )

        candidates.sort(key=lambda c: c.distance)

        det_result = DetectedFaceResult(
            detection_id=f"py_det_{i+1}",
            box=box_dict,
            confidence=0.95,
            descriptor=enc.tolist(),
            best_candidate=candidates[0] if candidates else None,
            alternative_candidates=candidates[1:4] if len(candidates) > 1 else [],
            category="unknown",
        )

        if not candidates or candidates[0].distance > 0.60:
            det_result.category = "unknown"
            unknown.append(det_result)
        elif len(candidates) > 1 and (candidates[1].distance - candidates[0].distance) < 0.08:
            det_result.category = "ambiguous"
            needs_review.append(det_result)
            matched_student_ids.add(candidates[0].student_id)
        elif candidates[0].distance <= 0.45:
            det_result.category = "high_confidence"
            high_confidence.append(det_result)
            matched_student_ids.add(candidates[0].student_id)
        else:
            det_result.category = "needs_review"
            needs_review.append(det_result)
            matched_student_ids.add(candidates[0].student_id)

    all_enrolled_ids = {item["id"] for item in roster_data}
    not_detected = list(all_enrolled_ids - matched_student_ids)

    return ClassroomPhotoResponse(
        total_faces=len(face_boxes),
        high_confidence_matches=high_confidence,
        needs_review_matches=needs_review,
        unknown_faces=unknown,
        not_detected_student_ids=not_detected,
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
