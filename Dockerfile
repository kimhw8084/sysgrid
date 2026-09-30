FROM node:22-bookworm-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ENV VITE_API_BASE_URL="" VITE_IDENTITY_MODE=trusted_proxy
RUN npm run build

FROM python:3.14-slim-bookworm
WORKDIR /app
COPY backend/requirements.lock backend/requirements.lock
RUN python -m pip install --no-cache-dir --require-hashes -r backend/requirements.lock
COPY backend/ backend/
COPY scripts/paas.py scripts/paas.py
COPY --from=frontend /build/frontend/dist frontend/dist
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["python", "scripts/paas.py", "serve"]
