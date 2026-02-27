---
layout: archive
title: "CV"
permalink: /cv/
author_profile: true
redirect_from:
  - /resume
---

{% include base_path %}

## Education

* **MSc in Computer Science**, ETH Zurich, 2025 -- 2027 (expected)
  * CGPA: 5.7/6.0
  * Relevant Coursework: Probabilistic AI, Hardware Acceleration for Data Processing, Cloud Computing Architecture

* **BSc in Computer Engineering**, Middle East Technical University, 2020 -- 2025
  * CGPA: 3.91/4.0
  * Graduation Rank: 6th/286
  * Relevant Coursework: Guided Research, Machine Learning, Deep Learning, Big Data Engineering, Logic for Computer Science

* **Erasmus Exchange**, Saarland University / Max Planck Institute for Informatics, Apr 2024 -- Sep 2024

## Experience

* **Teaching Assistant** -- ETH Zurich MAS AID Program (Sep 2025 -- Present)
  * Working as a Teaching Assistant for the MAS AID program, enhancing managers' technical understanding of machine learning.
  * Developed a multilingual Legal RAG system indexing 60k+ sources, implementing an evaluation pipeline using keyword matching and LLM judges. Created 5 weeks of curriculum and coding notebooks.
  * Engineered synthetic patient data for an EHR classification project, optimizing signal density for meaningful learning outcomes.

* **Guest Researcher** -- UIUC Intelligent CAT Lab (Jun 2025 -- Sep 2025)
  * Developed a multi-step pipeline to automatically collect buggy in-context learning (ICL) examples from public GitHub repositories.
  * Mined and compiled a dataset of buggy code and corresponding fixes to enhance AI coding agents.
  * Supervised by Prof. Reyhan Jabbarvand.

* **Undergraduate Researcher** -- Applied NLP Lab, METU (Oct 2024 -- Sep 2025)
  * Developed the reliability dataset for the OpenEthics paper.
  * Implemented the LLM judge and rejection evaluation pipelines.
  * Co-authored sections of the research paper analyzing LLM ethical performance in Turkish and English.
  * Supervised by Prof. Çağrı Toraman.

* **AI Engineer** -- Eluvium, London, UK (Feb 2025 -- Mar 2025)
  * Designed and implemented an end-to-end AI agent for masking PII in emails while preserving original style.
  * Researched and tested LangSmith autoevaluators to optimize prompts and create datasets.

* **Guest Researcher** -- ETH Zurich LRE Lab (Feb 2025 -- Mar 2025)
  * Replicated a Chain-of-Thought research paper to validate findings for an upcoming publication.

* **AI Engineer Intern** -- Nevitech, Istanbul, TR (Jan 2025 -- Feb 2025)
  * Developed an AI agent for classifying ambiguous item names into UNSPSC codes, commissioned by Turkcell.
  * Achieved 90%+ accuracy integrating 5+ LLM providers with few-shot prompting via vector search.

* **Undergraduate Researcher** -- ImageLab, METU (Nov 2023 -- Apr 2024)
  * Researched low memory cost real-time image classification using deep equilibrium (DEQ) architecture.
  * Supervised by Dr. Gökberk Cinbiş and Dr. Emre Akbaş.

* **Candidate Software Engineer** -- Turkish Aerospace (Nov 2023 -- Jan 2024)
  * Contributed to porting a C# desktop application to a secure website.

* **Software Engineer Intern** -- SRDC Software (Jul 2023 -- Aug 2023)
  * Developed a CRUD front-end application for the ADLIFE project in Angular for managing FHIR data types.
  * Tools: socket programming, multithread programming, PostgreSQL, Spring Boot, JDBC, MEAN stack.

## Publications

  <ul>{% for post in site.publications reversed %}
    {% include archive-single-cv.html %}
  {% endfor %}</ul>

## Skills

* **Languages:** Turkish (native), English (C1 / IELTS 8)
* **Programming Languages:** Python, C++, C, SQL
* **NLP:** LangChain, RAG, LLM, Agentic workflows, Text-to-SQL
* **ML:** PyTorch, NumPy
* **Other Interests:** Operating Systems
