"""在 ComfyUI 的便携 Python 里跑 kohya sd-scripts，训练大肥鱼角色 LoRA。

embedded python 带 ._pth 隔离，PYTHONPATH 不生效，所以先把 trainlibs 塞进 sys.path。
trainlibs 里的 CPU 版 torch 已经删掉，会用 Python 自带的 cu130 torch。
"""

import runpy
import sys
from pathlib import Path

TRAINLIBS = Path(r"D:/AI/trainlibs")
SCRIPT = Path(r"D:/AI/sd-scripts/train_network.py")

sys.path.insert(0, str(SCRIPT.parent))

ARGS = [
    "--pretrained_model_name_or_path",
    r"D:/AI/ComfyUI_windows_portable/ComfyUI/models/checkpoints/Counterfeit-V3.0_fp16.safetensors",
    "--train_data_dir",
    r"D:/AI/dafeiyu/lora-train",
    "--output_dir",
    r"D:/AI/dafeiyu/lora-out",
    "--output_name",
    "dafeiyu_whalemaid_v2",
    "--network_weights",
    r"D:/AI/dafeiyu/lora-out/dafeiyu_whalemaid_v1-000004.safetensors",
    "--network_module",
    "networks.lora",
    "--network_dim",
    "32",
    "--network_alpha",
    "16",
    "--resolution",
    "512,512",
    "--enable_bucket",
    "--min_bucket_reso",
    "384",
    "--max_bucket_reso",
    "768",
    "--train_batch_size",
    "2",
    "--max_train_epochs",
    "6",
    "--learning_rate",
    "1e-4",
    "--text_encoder_lr",
    "5e-5",
    "--lr_scheduler",
    "cosine",
    "--lr_warmup_steps",
    "100",
    "--optimizer_type",
    "AdamW",
    "--mixed_precision",
    "fp16",
    "--save_precision",
    "fp16",
    "--save_every_n_epochs",
    "2",
    "--save_model_as",
    "safetensors",
    "--caption_extension",
    ".txt",
    "--shuffle_caption",
    "--keep_tokens",
    "1",
    "--cache_latents",
    "--cache_latents_to_disk",
    "--gradient_checkpointing",
    # "--sdpa",
    "--seed",
    "42",
    "--max_data_loader_n_workers",
    "2",
    "--persistent_data_loader_workers",
    "--logging_dir",
    r"D:/AI/dafeiyu/lora-logs",
]

sys.argv = [str(SCRIPT)] + ARGS
print("训练启动，参数条数:", len(ARGS), flush=True)
runpy.run_path(str(SCRIPT), run_name="__main__")
