"""Project environment time rules (软考项目环境时间规则).

Pure functions, zero LLM / zero DB: the API layer uses them to reject or warn
at write time, the verification pipeline re-runs them on generated material.
Rules:
- R1: period format "YYYY.MM" and start <= end.
- R2: project span strictly 6-10 months (no ±1 tolerance).
- R3: end must be at least 13 full months before now (2026.10 -> end<=2025.09).
- R4: runtime duration phrases vs the period span (warning only).
- R5: technology GA ordering against the anchor table.
- R8: user-given period conflicts with the server-computed legal window hint.
"""

import re
from datetime import datetime
from typing import Any, Dict, List, Optional

MONTH_RE = re.compile(r"^\d{4}\.(?:0[1-9]|1[0-2])$")

MIN_SPAN_MONTHS = 6
MAX_SPAN_MONTHS = 10
MIN_END_AGE_MONTHS = 13

SOURCE_TYPES = ("real", "mock")

INVALID_TECH_SUFFIX_PATTERN = re.compile(
    r"(?:[a-z0-9_]+|[A-Z][a-z0-9]+)?(?:Id|Code|Type|Status|Num|Flag|List|Map|Key|Name|Time|Date|Val|Value|Count|Index|No|Desc|Info)$",
    re.IGNORECASE,
)

# Era-specific technologies with their earliest emergence month (YYYY.MM)
ERA_SPECIFIC_TECHS: Dict[str, str] = {
    "qwen": "2023.08",
    "llama": "2023.02",
    "vllm": "2023.06",
    "deepseek": "2023.11",
    "chatgpt": "2022.11",
    "gpt-4": "2023.03",
    "langchain": "2022.10",
    "llamaindex": "2022.11",
    "dify": "2023.05",
    "ragflow": "2024.04",
    "fastgpt": "2023.04",
    "baichuan": "2023.06",
    "chatglm": "2023.03",
    "mistral": "2023.09",
    "ollama": "2023.07",
    "chromadb": "2023.02",
}

# Mainstream engineering and architecture technologies
KNOWN_TECHS: set[str] = {
    # Languages & runtimes
    "python",
    "java",
    "go",
    "golang",
    "c",
    "c++",
    "cpp",
    "c#",
    "csharp",
    "rust",
    "php",
    "ruby",
    "typescript",
    "javascript",
    "node",
    "nodejs",
    "node.js",
    "scala",
    "kotlin",
    "dart",
    "lua",
    "r",
    "dotnet",
    ".net",
    # Web & frameworks
    "spring",
    "spring boot",
    "springboot",
    "spring cloud",
    "spring security",
    "spring data",
    "spring batch",
    "quarkus",
    "micronaut",
    "gin",
    "beego",
    "fiber",
    "echo",
    "django",
    "fastapi",
    "flask",
    "tornado",
    "dubbo",
    "grpc",
    "thrift",
    "mybatis",
    "mybatis-plus",
    "hibernate",
    "jpa",
    "tomcat",
    "undertow",
    "jetty",
    "netty",
    "gunicorn",
    "uvicorn",
    "express",
    "koa",
    "nest",
    "nestjs",
    "next",
    "nextjs",
    "next.js",
    "nuxt",
    "nuxt.js",
    "vue",
    "react",
    "angular",
    "svelte",
    # Storage, databases, caches & search
    "mysql",
    "postgresql",
    "postgres",
    "oracle",
    "oracle data guard",
    "sql server",
    "sqlserver",
    "mssql",
    "sqlite",
    "mariadb",
    "tidb",
    "oceanbase",
    "polardb",
    "dameng",
    "dm8",
    "kingbase",
    "mongodb",
    "mongo",
    "mongodb spatial",
    "cassandra",
    "scylladb",
    "hbase",
    "redis",
    "memcached",
    "hazelcast",
    "elasticsearch",
    "opensearch",
    "solr",
    "clickhouse",
    "doris",
    "apache doris",
    "starrocks",
    "druid",
    "apache druid",
    "influxdb",
    "timescaledb",
    "tdengine",
    "neo4j",
    "nebula",
    "nebula graph",
    "minio",
    "ceph",
    "fastdfs",
    "etcd",
    "zookeeper",
    "consul",
    # Messaging & streams
    "kafka",
    "kafka streams",
    "rabbitmq",
    "rocketmq",
    "pulsar",
    "activemq",
    "emqx",
    "mqtt",
    "flink",
    "apache flink",
    "spark",
    "apache spark",
    "storm",
    # DevOps, cloud & mesh
    "kubernetes",
    "k8s",
    "docker",
    "containerd",
    "podman",
    "helm",
    "istio",
    "envoy",
    "linkerd",
    "nginx",
    "traefik",
    "kong",
    "apisix",
    "zuul",
    "spring cloud gateway",
    "nacos",
    "sentinel",
    "seata",
    "skywalking",
    "prometheus",
    "grafana",
    "jaeger",
    "zipkin",
    "elk",
    "filebeat",
    "logstash",
    "fluentd",
    "victoria metrics",
    "ansible",
    "terraform",
    "jenkins",
    "gitlab",
    "harbor",
    "argocd",
    "openstack",
    # Data integration & middleware
    "canal",
    "debezium",
    "maxwell",
    "datax",
    "sqoop",
    "seatunnel",
    "sharding-sphere",
    "shardingsphere",
    "mycat",
    "redisson",
    "lettuce",
    "jedis",
    "hikaricp",
    # AI / ML / vector & LLM
    "pytorch",
    "tensorflow",
    "keras",
    "scikit-learn",
    "sklearn",
    "pandas",
    "numpy",
    "scipy",
    "huggingface",
    "transformers",
    "deepspeed",
    "tensorrt",
    "triton",
    "ray",
    "mlflow",
    "kubeflow",
    "qwen",
    "llama",
    "vllm",
    "milvus",
    "dify",
    "ragflow",
    "fastgpt",
    "langchain",
    "llamaindex",
    "autogen",
    "chroma",
    "chromadb",
    "pinecone",
    "weaviate",
    "qdrant",
    "faiss",
    "ollama",
    "tgi",
    "llamacpp",
    "llama.cpp",
    "deepseek",
    "baichuan",
    "chatglm",
    "glm",
    "mistral",
    "claude",
    "chatgpt",
    "gpt",
    "gpt-3.5",
    "gpt-4",
    "kserve",
}


def is_valid_tech_name(name: str) -> bool:
    """Determine if a name is a genuine tech/tool rather than a business field."""
    if not name or not isinstance(name, str):
        return False
    s = name.strip()
    if not s:
        return False
    lowered = s.lower()
    normalized = re.sub(r"[\s\-_.]+", "", lowered)
    if lowered in KNOWN_TECHS or lowered in ERA_SPECIFIC_TECHS:
        return True
    if normalized in KNOWN_TECHS or normalized in ERA_SPECIFIC_TECHS:
        return True
    if not re.search(r"[a-zA-Z]", s):
        return False
    if INVALID_TECH_SUFFIX_PATTERN.search(s):
        return False
    if re.search(r"[,。，！？；;\n\r\t]", s):
        return False
    return True


# tech (lowercase) -> version -> GA month "YYYY.MM"; ~25 mainstream entries.
GA_ANCHORS: Dict[str, Dict[str, str]] = {
    "python": {
        "3.9": "2021.05",
        "3.10": "2021.10",
        "3.11": "2022.10",
        "3.12": "2023.10",
        "3.13": "2024.10",
    },
    "java": {"17": "2021.09", "21": "2023.09"},
    "go": {"1.21": "2023.08", "1.22": "2024.02"},
    "node": {"18": "2022.04", "20": "2023.04", "22": "2024.04"},
    "spring boot": {
        "2.7": "2022.05",
        "3.0": "2022.11",
        "3.2": "2023.11",
        "3.3": "2024.05",
    },
    "mysql": {"8.0": "2018.04", "8.4": "2024.07"},
    "postgresql": {"14": "2021.09", "15": "2022.10", "16": "2023.09"},
    "redis": {
        "6.0": "2020.05",
        "6.2": "2021.02",
        "7.0": "2022.05",
        "7.2": "2023.07",
    },
    "kafka": {"3.5": "2023.05", "3.7": "2024.03"},
    "rabbitmq": {"3.12": "2023.06", "3.13": "2024.02"},
    "kubernetes": {"1.27": "2023.04", "1.29": "2023.12", "1.30": "2024.04"},
    "docker": {"23": "2023.02", "24": "2023.05"},
    "elasticsearch": {"8.0": "2022.02", "8.13": "2024.03"},
    "clickhouse": {"23.3": "2023.03", "24.1": "2024.01"},
    "nginx": {"1.24": "2023.04", "1.25": "2023.05"},
    "vue": {"3.0": "2020.09", "3.4": "2023.12"},
    "react": {"18": "2022.03"},
    "pytorch": {"2.0": "2023.03", "2.3": "2024.04"},
    "qwen": {"2.5": "2024.09", "3": "2025.04"},
    "llama": {"3": "2024.04", "3.1": "2024.07"},
    "vllm": {"0.6": "2024.10"},
    "milvus": {"2.4": "2024.05"},
}


def mi(year: int, month: int) -> int:
    return year * 12 + month


def month_index(value: str) -> int:
    y, _, m = value.partition(".")
    return mi(int(y), int(m))


def now_month(now: Optional[datetime] = None) -> str:
    current = now or datetime.now()
    return f"{current.year:04d}.{current.month:02d}"


def is_month(value: Optional[str]) -> bool:
    return bool(value) and bool(MONTH_RE.match(value or ""))


def validate_period(
    start: Optional[str],
    end: Optional[str],
    source_type: str,
    now: Optional[datetime] = None,
    hint_start: Optional[str] = None,
    hint_end: Optional[str] = None,
) -> Dict[str, Any]:
    """Validate a project period; violations carry a severity that decides the
    API behavior: real-source R2/R3 violations only warn, mock/AI ones block."""
    violations: List[Dict[str, Any]] = []
    warn_or_block = "warn" if source_type == "real" else "block"

    if not is_month(start) or not is_month(end):
        violations.append(
            {
                "rule": "R1",
                "severity": "block",
                "params": {"period_start": start, "period_end": end},
                "message": "period_start/period_end must use the YYYY.MM format",
            }
        )
        return {"passed": False, "violations": violations}

    start_s, end_s = start or "", end or ""
    if month_index(end_s) < month_index(start_s):
        violations.append(
            {
                "rule": "R1",
                "severity": "block",
                "params": {"period_start": start_s, "period_end": end_s},
                "message": "period_end cannot be earlier than period_start",
            }
        )
        # span/end-age checks are meaningless on an inverted period
        return {"passed": False, "violations": violations}

    span = month_index(end_s) - month_index(start_s) + 1
    if not MIN_SPAN_MONTHS <= span <= MAX_SPAN_MONTHS:
        violations.append(
            {
                "rule": "R2",
                "severity": warn_or_block,
                "params": {"span_months": span},
                "message": f"project span must be {MIN_SPAN_MONTHS}-{MAX_SPAN_MONTHS} "
                f"months (got {span})",
            }
        )

    current = now or datetime.now()
    end_age = month_index(now_month(current)) - month_index(end_s)
    if end_age < MIN_END_AGE_MONTHS:
        violations.append(
            {
                "rule": "R3",
                "severity": warn_or_block,
                "params": {
                    "period_end": end_s,
                    "latest_allowed_end": latest_allowed_end(current),
                },
                "message": f"project must have ended at least {MIN_END_AGE_MONTHS} "
                f"months ago (latest allowed end: {latest_allowed_end(current)})",
            }
        )

    # R8: the pair is illegal while the server-computed hint would be legal ->
    # report the hint so callers can offer/apply the suggestion.
    hint_s, hint_e = hint_start or "", hint_end or ""
    if violations and is_month(hint_s) and is_month(hint_e):
        hint_ok = (
            month_index(hint_e) >= month_index(hint_s)
            and MIN_SPAN_MONTHS
            <= month_index(hint_e) - month_index(hint_s) + 1
            <= MAX_SPAN_MONTHS
            and month_index(now_month(current)) - month_index(hint_e)
            >= MIN_END_AGE_MONTHS
        )
        if hint_ok:
            violations.append(
                {
                    "rule": "R8",
                    "severity": warn_or_block,
                    "params": {
                        "suggested_start": hint_s,
                        "suggested_end": hint_e,
                    },
                    "message": "given period conflicts with the legal window; "
                    f"suggested window: {hint_s} - {hint_e}",
                }
            )

    return {"passed": not violations, "violations": violations}


def shift_month(month: str, delta: int) -> str:
    """Shift a "YYYY.MM" string by delta months (delta may be negative)."""
    idx = month_index(month) + delta
    y, m = divmod(idx - 1, 12)
    return f"{y:04d}.{m + 1:02d}"


def latest_allowed_end(now: Optional[datetime] = None) -> str:
    return shift_month(now_month(now or datetime.now()), -MIN_END_AGE_MONTHS)


def legal_window(now: Optional[datetime] = None) -> Dict[str, str]:
    """Server-computed legal period window: the widest start/end pair that
    satisfies R2+R3 for the current month."""
    current = now or datetime.now()
    end_latest = latest_allowed_end(current)
    start_earliest = shift_month(end_latest, -(MAX_SPAN_MONTHS - 1))
    return {
        "legal_start_earliest": start_earliest,
        "legal_end_latest": end_latest,
        "now_month": now_month(current),
    }


def complete_period(
    start: Optional[str], end: Optional[str], now: Optional[datetime] = None
) -> Dict[str, Any]:
    """Complete a partially given period from the legal window (R8 handling).
    Returns the completed pair or a violation list when no legal completion
    exists (e.g. start so late that even a 6-month span violates R3)."""
    window = legal_window(now)
    if not is_month(start) and not is_month(end):
        return {
            "period_start": window["legal_start_earliest"],
            "period_end": window["legal_end_latest"],
            "violations": [],
        }
    if is_month(start) and not is_month(end):
        start_s = start or ""
        end_s = min(
            shift_month(start_s, MAX_SPAN_MONTHS - 1), window["legal_end_latest"]
        )
        if month_index(end_s) - month_index(start_s) + 1 < MIN_SPAN_MONTHS:
            return {
                "violations": [
                    {
                        "rule": "R8",
                        "severity": "block",
                        "params": {"period_start": start_s},
                        "message": "period_start leaves no legal 6-10 month "
                        "window ending at least 13 months ago",
                    }
                ]
            }
        return {"period_start": start_s, "period_end": end_s, "violations": []}
    # end given without start
    end_s = end or ""
    start_s = max(
        shift_month(end_s, -(MAX_SPAN_MONTHS - 1)),
        window["legal_start_earliest"],
    )
    if month_index(end_s) - month_index(start_s) + 1 < MIN_SPAN_MONTHS:
        return {
            "violations": [
                {
                    "rule": "R8",
                    "severity": "block",
                    "params": {"period_end": end_s},
                    "message": "period_end leaves no legal 6-10 month window",
                }
            ]
        }
    return {"period_start": start_s, "period_end": end_s, "violations": []}


_DURATION_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(个?月|年|year|month)", re.IGNORECASE)


def check_runtime_consistency(
    scale_text: Optional[str], period_start: str, period_end: str
) -> Dict[str, Any]:
    """R4: cross-check duration phrases in the scale text against the period
    span. Warning-level only, never blocks."""
    violations: List[Dict[str, Any]] = []
    if not scale_text:
        return {"passed": True, "violations": violations}
    if not (is_month(period_start) and is_month(period_end)):
        return {"passed": True, "violations": violations}
    span = month_index(period_end) - month_index(period_start) + 1
    for match in _DURATION_RE.finditer(scale_text):
        value = float(match.group(1))
        unit = match.group(2).lower()
        months = (
            int(round(value * 12))
            if ("年" in unit or "year" in unit)
            else int(round(value))
        )
        if not 1 <= months <= 36:
            continue  # not a plausible project duration phrase
        if not MIN_SPAN_MONTHS <= months <= MAX_SPAN_MONTHS:
            violations.append(
                {
                    "rule": "R4",
                    "severity": "warning",
                    "params": {"stated_months": months, "span_months": span},
                    "message": f"stated runtime {months} months disagrees with "
                    f"period span {span} months",
                }
            )
    return {"passed": not violations, "violations": violations}


def lookup_ga_month(versions: Dict[str, str], version: str) -> Optional[str]:
    """Resolve a version string against one tech's anchor rows: exact match,
    then 8.0.x -> 8.0 fallback, then the conservative bare-major rule
    (earliest GA within that major). None when the version cannot be dated."""
    version = (version or "").strip().lstrip("vV")
    ga = versions.get(version) or versions.get(version.removesuffix(".0"))
    if not ga:
        # 8.0.x style: try the leading major.minor
        parts = version.split(".")
        if len(parts) > 2:
            ga = versions.get(f"{parts[0]}.{parts[1]}")
    if not ga and version.isdigit():
        # bare major ("Spring Boot 3") only: earliest GA within that major —
        # the most conservative anchor. Versioned minors (3.4, 1.50) stay
        # undated here: a mid-major release cannot be dated by the major's GA.
        same_major = [g for v, g in versions.items() if v.startswith(f"{version}.")]
        if same_major:
            ga = min(same_major, key=month_index)
    return ga


def check_ga_ordering(
    tech: Optional[str],
    version_or_ga: Optional[str],
    period_start: str,
    extra_anchors: Optional[Dict[str, Dict[str, str]]] = None,
) -> Dict[str, Any]:
    """R5: GA ordering pre-screen for a version claim.

    Returns status "pass" | "fail" | "off_table" | "unspecified":
    - pass/fail: the tech+version has a GA anchor (static table or the
      dynamic `extra_anchors` passed by the caller) and the GA month is
      before/after the project start.
    - off_table: no anchor anywhere -> callers escalate (dynamic cache,
      web lookup) instead of blocking; the LLM lanes judge plausibility.
    - unspecified: the claim does not name a version at all, or tech is not a valid tech.
    """
    if not tech or not is_valid_tech_name(tech):
        return {"status": "unspecified"}
    key = tech.strip().lower()
    if not version_or_ga:
        if key in ERA_SPECIFIC_TECHS and is_month(period_start):
            earliest = ERA_SPECIFIC_TECHS[key]
            if month_index(earliest) > month_index(period_start):
                return {
                    "status": "fail",
                    "ga": earliest,
                    "message": f"{tech} 是时代专属性新技术（最早出现于 {earliest}），晚于项目开始时间 ({period_start})",
                }
        return {"status": "unspecified"}
    if not is_month(period_start):
        return {"status": "off_table"}
    if key in ERA_SPECIFIC_TECHS:
        earliest = ERA_SPECIFIC_TECHS[key]
        if month_index(earliest) > month_index(period_start):
            return {
                "status": "fail",
                "ga": earliest,
                "message": f"{tech} 是时代专属性新技术（最早出现于 {earliest}），晚于项目开始时间 ({period_start})",
            }
    version = version_or_ga.strip().lstrip("vV")
    versions = GA_ANCHORS.get(key)
    if extra_anchors:
        merged = dict(versions or {})
        merged.update(extra_anchors.get(key) or {})
        versions = merged or None
    if not versions:
        return {"status": "off_table", "tech": key}
    ga = lookup_ga_month(versions, version)
    if not ga:
        return {"status": "off_table", "tech": key, "version": version}
    if month_index(ga) <= month_index(period_start):
        return {"status": "pass", "ga": ga}
    return {
        "status": "fail",
        "ga": ga,
        "message": f"{key} {version} GA ({ga}) is after project start ({period_start})",
    }
