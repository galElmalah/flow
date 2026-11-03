"""Final result on stdout; measured stage events on stderr."""
import argparse
import json
import sys
import math
import uuid
from pathlib import Path

def progress(stage, message, completed=None, total=None):
    event = {"stage": stage, "message": message}
    if total is not None:
        event.update(completed=completed, total=total)
    print("FLOW_SAM_PROGRESS " + json.dumps(event), file=sys.stderr, flush=True)

progress("runtime", "Starting Python and PyTorch")
import cv2
import numpy as np
from PIL import Image, ImageOps
import torch
from sam2.build_sam import build_sam2
from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator
from sam2.sam2_image_predictor import SAM2ImagePredictor

parser = argparse.ArgumentParser()
parser.add_argument("--checkpoint", required=True)
parser.add_argument("--input", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--point")
parser.add_argument("--variant", choices=["tiny", "large"], default="tiny")
args = parser.parse_args()
source = ImageOps.exif_transpose(Image.open(args.input)).convert("RGB")
original_width, original_height = source.size
source.thumbnail((1024, 1024))
image = np.array(source)
height, width = image.shape[:2]
device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
if device == "cpu":
    torch.set_num_threads(min(8, torch.get_num_threads()))
progress("loading", f"Loading SAM 2.1 {args.variant} on {device.upper()}")
model = build_sam2("configs/sam2.1/sam2.1_hiera_" + ("l" if args.variant == "large" else "t") + ".yaml", args.checkpoint, device=device, apply_postprocessing=False)

class ProgressMaskGenerator(SAM2AutomaticMaskGenerator):
    # The pinned upstream generator calls this once per completed prompt batch.
    def _process_batch(self, *batch_args, **kwargs):
        total = math.ceil(len(self.point_grids[0]) / self.points_per_batch)
        done = getattr(self, "completed_batches", 0)
        progress("sampling", "Finding objects", done, total)
        result = super()._process_batch(*batch_args, **kwargs)
        self.completed_batches = done + 1
        progress("sampling", "Finding objects", done + 1, total)
        return result

progress("encoding", "Encoding image features")
with torch.inference_mode():
    if args.point:
        point = json.loads(args.point)
        predictor = SAM2ImagePredictor(model)
        predictor.set_image(image)
        progress("sampling", "Predicting the selected object", 0, 1)
        masks, scores, _ = predictor.predict(point_coords=np.array([[point["x"] * width, point["y"] * height]]), point_labels=np.array([1]), multimask_output=True)
        progress("sampling", "Predicting the selected object", 1, 1)
        index = int(np.argmax(scores))
        proposals = [{"segmentation": masks[index], "predicted_iou": float(scores[index])}]
    else:
        generator = ProgressMaskGenerator(model, points_per_side=20, points_per_batch=16, pred_iou_thresh=0.72, stability_score_thresh=0.88, crop_n_layers=0, min_mask_region_area=0, output_mode="binary_mask")
        proposals = generator.generate(image)
    regions = []
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    proposals = sorted(proposals, key=lambda p: np.count_nonzero(p["segmentation"]), reverse=True)[:80]
    for number, proposal in enumerate(proposals):
        progress("exporting", "Exporting original-resolution masks", number, len(proposals))
        mask = cv2.resize(proposal["segmentation"].astype(np.uint8), (original_width, original_height), interpolation=cv2.INTER_NEAREST)
        area = int(np.count_nonzero(mask))
        if area < original_width * original_height * 0.001 or area > original_width * original_height * 0.98:
            continue
        contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        paths = []
        for contour in contours:
            if cv2.contourArea(contour) < 10:
                continue
            points = cv2.approxPolyDP(contour, 0.8, True).reshape(-1, 2)
            paths.append("M" + "L".join(f"{int(x)} {int(y)}" for x, y in points) + "Z")
        if not paths:
            continue
        region_id = "region-" + str(uuid.uuid4())
        Image.fromarray(mask * 255).save(output / (region_id + ".png"))
        x, y, w, h = cv2.boundingRect(mask)
        _, _, _, interior = cv2.minMaxLoc(cv2.distanceTransform(mask, cv2.DIST_L2, 3))
        regions.append({"id": region_id, "path": "".join(paths), "bbox": [x, y, w, h], "anchor": {"x": interior[0] / original_width, "y": interior[1] / original_height}, "area": area, "score": float(proposal["predicted_iou"]), "file": region_id + ".png"})
    progress("exporting", "Masks exported", len(proposals), len(proposals))
print(json.dumps({"model": "sam2.1-hiera-" + args.variant, "device": device, "width": original_width, "height": original_height, "regions": regions}))
