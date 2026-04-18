# MorseMelody / 声印 — ModelScope Studio 部署
# 文档见仓库根目录 MODELSCOPE.md

# ---------- 前端构建（须与仓库根目录的 data/ 同级，供 Vite 解析 ../../data/*.json）----------
FROM node:20-bookworm-slim AS frontend-build
WORKDIR /repo/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
COPY data/ /repo/data/
RUN npm run build

# ---------- 运行镜像 ----------
FROM modelscope-registry.cn-beijing.cr.aliyuncs.com/modelscope-repo/python:3.10

WORKDIR /home/user/app

# pydub 混音导出 mp3 等需要 ffmpeg
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /home/user/app/backend/requirements.txt
RUN pip install --no-cache-dir -r /home/user/app/backend/requirements.txt

COPY backend/ /home/user/app/backend/
COPY app.py /home/user/app/app.py
COPY --from=frontend-build /repo/frontend/dist /home/user/app/frontend/dist

ENV HOST=0.0.0.0
ENV PORT=7860
ENV MORSE_SPA_DIST=/home/user/app/frontend/dist

EXPOSE 7860

ENTRYPOINT ["python", "-u", "app.py"]
