# TRACE — Explainable Multi-Agent Research Discovery System

TRACE is an evidence-oriented multi-agent research discovery system designed to support literature exploration, evidence extraction, validation, synthesis, and research knowledge mapping.

The system accepts a natural-language research question and processes it through a sequence of specialized agents. TRACE combines deterministic software logic with LLM-based tasks so that retrieved literature, evidence, validation decisions, and final findings remain traceable to their sources.

---

## Overview

Traditional literature discovery often requires researchers to manually:

- formulate search strategies
- discover relevant papers
- inspect abstracts and full text
- extract useful evidence
- compare findings across studies
- identify supporting or conflicting evidence
- synthesize the literature
- track citations and sources

TRACE automates and organizes these stages through a multi-agent research workflow.

The system does not rely entirely on an LLM. Deterministic application logic controls retrieval, filtering, ranking, evidence handling, validation rules, refinement decisions, provenance, and downstream data flow, while LLMs are used for bounded language-based tasks.

---

## Key Features

### 1. Structured Research Planning

The Planner Agent converts a natural-language research question into a structured research plan containing:

- research objectives
- sub-questions
- comparison dimensions
- evidence targets
- targeted search queries

This provides a structured starting point for the downstream research workflow.

---

### 2. Multi-Source Literature Discovery

TRACE retrieves scholarly literature using external academic sources including:

- OpenAlex
- Semantic Scholar

Retrieved papers are normalized, deduplicated, filtered, and ranked before being passed to downstream stages.

---

### 3. Evidence Acquisition

TRACE attempts to obtain usable evidence from available scholarly sources.

Depending on source availability, evidence can be classified into different levels:

- **Full Text** — evidence obtained from an acquired and parsed full-text document
- **Abstract** — evidence obtained from an accessible abstract
- **Metadata** — limited evidence available from bibliographic metadata

TRACE also supports PDF acquisition and structured document processing through GROBID when full-text documents are available.

---

### 4. Evidence Analysis

The Evidence Analyst processes the available research material and produces candidate findings grounded in the supplied evidence.

The analysis stage preserves links between findings and the papers/evidence from which they were derived.

---

### 5. Critic Validation

The Critic Agent evaluates candidate findings against available evidence.

The validation stage considers factors such as:

- evidence support
- relevance
- contradictions
- evidence coverage
- insufficient evidence

When the available evidence is insufficient, TRACE can trigger targeted refinement and additional exploration.

---

### 6. Refinement and Recovery

TRACE supports controlled refinement of the research process.

When the Critic identifies insufficient or weak evidence, the system can generate a targeted recovery/refinement path rather than blindly repeating the entire workflow.

The orchestration layer controls when refinement is allowed and prevents uncontrolled execution.

---

### 7. Evidence-Grounded Synthesis

The Synthesizer produces the final research synthesis from the validated findings and selected research context.

The synthesis stage is bounded by deterministic context-selection and resource policies.

The final report can include:

- research findings
- supporting evidence
- research gaps
- methodological observations
- references

---

### 8. Provenance and Traceability

TRACE maintains provenance information throughout the research workflow.

Important research objects can be associated with:

- Paper IDs
- Evidence IDs
- Finding relationships
- validation information
- source information

This allows the user to inspect how research findings relate to their underlying evidence.

---

### 9. Evidence Graph

TRACE constructs a knowledge graph from research information such as:

- papers
- authors
- concepts
- venues
- relationships between research entities

The graph provides a visual representation of the research landscape.

---

### 10. Graph-Based Research Exploration

TRACE includes a graph-based retrieval component for exploring the constructed research graph.

The current implementation uses deterministic query-to-entity matching followed by depth-limited graph traversal.

This is a graph-based retrieval approach and does not depend on a vector database or embedding-based retrieval system.

---

### 11. Citation Explorer

The Citation Explorer provides an interactive view of the papers available within the final research context and their relationships.

The displayed supporting papers represent the papers selected and supplied to the synthesis stage under the current system policies.

---

### 12. Research Gap Analysis

TRACE provides a research-gap analysis view that helps identify areas where the available literature contains limited or insufficient evidence.

The system distinguishes between situations such as:

- insufficient evidence
- unavailable evidence
- identified research gaps
- areas where no conclusion can safely be made

A lack of retrieved evidence is not automatically treated as proof that no research exists.

---

### 13. Methodology Review

TRACE provides a methodology-oriented view of the retrieved research, allowing users to inspect methodological information associated with the available papers and evidence.

---

## System Architecture

The TRACE backend consists of five specialized agents implemented as JavaScript components.

The agents use an LLM for specific language-based tasks, while deterministic JavaScript logic controls the overall workflow.

```text
                         USER QUERY
                              |
                              v
                     +----------------+
                     | Planner Agent  |
                     +-------+--------+
                             |
                             v
                     +----------------+
                     | Explorer Agent |
                     +-------+--------+
                             |
                 +-----------+-----------+
                 |                       |
                 v                       v
             OpenAlex              Semantic Scholar
                 |                       |
                 +-----------+-----------+
                             |
                             v
                  Full-Text Acquisition
                         / GROBID
                             |
                             v
                  +---------------------+
                  | Evidence Analyst    |
                  +----------+----------+
                             |
                             v
                  +---------------------+
                  | Critic Agent        |
                  +----------+----------+
                             |
                       Evidence
                       sufficient?
                       /       \
                     No         Yes
                     |           |
                     v           v
                Refinement   Synthesizer
                     |           |
                     |           v
                     +------> Final Evidence
                              Registry
                                  |
                +-----------------+----------------+
                |                 |                |
                v                 v                v
          Research Report   Evidence Graph   Citation Explorer

4. Multi-Agent Workflow
Planner Agent

Purpose: Research planning

Input:

User research question

Output:

Research objectives
Sub-questions
Research dimensions
Evidence targets
Search queries
Explorer Agent

Purpose: Literature discovery and exploration

Input:

Structured research plan

Output:

Retrieved and processed scholarly papers

The deterministic retrieval layer performs normalization, deduplication, relevance filtering, and ranking.

The LLM may provide advisory query refinement, but it does not independently determine the final paper ranking.

Evidence Analyst

Purpose: Evidence extraction and analytical findings

Input:

Retrieved papers
Available evidence

Output:

Candidate findings
Evidence relationships
Critic Agent

Purpose: Evidence validation and refinement

Input:

Candidate findings
Supporting evidence
Research context

Output:

Validation decisions
Support categories
Contradiction information
Evidence coverage observations
Refinement requirements
Synthesizer Agent

Purpose: Final research synthesis

Input:

Validated findings
Selected research context
Evidence information

Output:

Final research synthesis
Findings
Research gaps
References and evidence relationships
5. Technology Stack
Layer	Technology
Frontend	React
Frontend Build Tool	Vite
Styling	Tailwind CSS
Backend	Node.js
API Framework	Express.js
Database	MongoDB
ODM	Mongoose
LLM Integration	OpenAI-compatible API interface
Current LLM Provider	Mistral API
Literature Discovery	OpenAlex
Literature Discovery	Semantic Scholar
Full-Text Processing	GROBID
Containerization	Docker
Data Format	JSON
Graph Processing	Application-level graph construction and traversal
6. LLM and Deterministic Processing

TRACE follows a deterministic-first design.

LLM Responsibilities

LLMs are used for bounded language-oriented tasks such as:

Generating research plans
Advisory query refinement
Extracting analytical findings
Judging evidence support
Generating final synthesis
Deterministic Responsibilities

Application code controls:

API orchestration
Schema validation
Paper normalization
Deduplication
Relevance filtering
Ranking
Evidence-level assignment
Refinement decisions
Context limits
Provenance
Graph construction
Graph layout
Resource limits
Fallback behaviour

This separation helps keep the research pipeline controlled and inspectable.

7. Evidence Levels

TRACE records the level of evidence available for research material.

Full Text

Evidence was successfully obtained from an acquired and parsed full-text document.

Abstract

Only an accessible abstract was available for the relevant evidence.

Metadata

Only bibliographic or metadata-level information was available.

TRACE does not treat every retrieved paper as a full-text source.

8. Full-Text Processing

When full-text documents are available, TRACE can use GROBID to convert PDF documents into structured TEI/XML representations.

The structured content can then be processed by the evidence analysis pipeline.

Full-text acquisition depends on source availability. Publisher restrictions, inaccessible documents, failed downloads, or unavailable open-access copies can prevent full-text extraction.

9. GraphRAG

TRACE includes a graph-based retrieval component for research graph exploration.

The current implementation performs:

User Query
    |
    v
Query-to-Entity Matching
    |
    v
Matched Graph Entities
    |
    v
Depth-Limited BFS Traversal
    |
    v
Graph Context

The current implementation is deterministic and does not use an embedding-based vector database for graph retrieval.

10. Frontend

The React frontend provides an interactive research workspace with views including:

Research Workspace
Research Report
Retrieved Papers
Exact Evidence
Methodology Review
Research Gap Analysis
Evidence Graph
Citation Explorer
Research activity information
Export functionality

The frontend communicates with the Node.js/Express backend through REST APIs.

11. Project Structure
TRACE/
│
├── README.md
│
├── backend/
│   ├── src/
│   │   ├── ai/
│   │   └── ...
│   │
│   ├── scripts/
│   ├── uploads/
│   ├── package.json
│   ├── package-lock.json
│   └── .gitignore
│
├── frontend/
│   ├── src/
│   ├── public/
│   ├── package.json
│   ├── package-lock.json
│   └── .gitignore
│
└── docs/
    └── ...

node_modules directories are intentionally excluded from version control.

12. Research Pipeline

A typical TRACE research run follows:

1. User submits research question
              |
              v
2. Planner creates structured research plan
              |
              v
3. Explorer discovers scholarly papers
              |
              v
4. Papers are normalized, deduplicated and ranked
              |
              v
5. Full-text/evidence acquisition is attempted
              |
              v
6. Evidence Analyst extracts candidate findings
              |
              v
7. Critic validates findings and evidence
              |
              v
8. Refinement occurs when additional evidence is required
              |
              v
9. Synthesizer generates the final research synthesis
              |
              v
10. Final evidence registry is constructed
              |
              v
11. Research report, graph and citation views are generated

13. Reliability and Resource Controls

TRACE contains mechanisms intended to prevent uncontrolled execution.

These include:

LLM call limits
Bounded context sizes
Configurable timeouts
Retry handling
Provider circuit-breaker behaviour
Deterministic fallbacks
Schema-validated agent outputs
Controlled refinement
Evidence-level tracking

The system is designed to stop safely when critical provider or resource limits prevent reliable continuation.

15. Current Limitations

TRACE is a research prototype and has several limitations.

External Source Availability

Full-text evidence depends on whether accessible documents can be obtained from available sources.

LLM Provider Limits

The live research workflow depends on the configured LLM provider and is subject to provider availability, quotas, and rate limits.

Evidence Coverage

Not every retrieved paper will have full-text evidence available.

Confidence Interpretation

Confidence values generated by the current system should not be interpreted as experimentally calibrated probabilities or universal accuracy measurements.

No Universal End-to-End Accuracy Claim

TRACE does not currently claim a single overall accuracy score for the complete research pipeline.

Meaningful evaluation can instead consider component-level measures such as:

Retrieval precision and recall
Evidence extraction quality
Finding support accuracy
Citation correctness
Grounding and faithfulness
Research-gap assessment
Report quality
Execution latency
16. Security Notes

Before publishing or distributing the repository:

Remove all API keys.
Do not commit .env files containing secrets.
Do not commit database credentials.
Do not commit private documents.
Do not commit node_modules.
Do not commit unnecessary generated build files.
Review uploaded files and logs for sensitive information.

Environment-specific configuration should remain local and should be represented through safe example values where necessary.

17. Development Principles
Deterministic First

Critical application decisions should remain controlled by deterministic code wherever possible.

Bounded LLM Usage

LLMs are used for clearly defined language tasks rather than unrestricted control of the complete application.

Schema-Validated Handoffs

Agent outputs are structured and validated before being passed to downstream stages.

Evidence First

Research findings should retain relationships to their available evidence.

Provenance

Important research objects should remain traceable to their sources and intermediate processing stages.

Resource Bounding

The workflow uses limits on execution, context, retries, and LLM calls to reduce uncontrolled resource usage.

18. Future Scope

Potential future development areas include:

Hybrid semantic and graph retrieval
Automated claim-citation verification
Adaptive research planning
Temporal research knowledge graphs
Confidence calibration
More comprehensive research-gap analysis
Improved contradiction detection
Stronger evaluation benchmarks for evidence-grounded research workflows

These are future directions and are not represented as fully implemented capabilities in the current version.

19. Project Status, Acknowledgement and License
Project Status

Status: Research Prototype

TRACE currently demonstrates an end-to-end evidence-oriented multi-agent research workflow covering:

Research Planning
       ↓
Literature Discovery
       ↓
Evidence Acquisition
       ↓
Evidence Analysis
       ↓
Critic Validation
       ↓
Controlled Refinement
       ↓
Research Synthesis
       ↓
Provenance & Evidence Registry
       ↓
Research Report
       ↓
Knowledge Graph
       ↓
Citation Exploration
Acknowledgement

TRACE was developed as an academic project exploring the use of multi-agent systems, scholarly information retrieval, evidence processing, provenance, and explainable research workflows.

License

Add the appropriate project license here if the repository is intended to be publicly distributed.
