"""Retrieval over notes: keyword ranking, embeddings, rank fusion, duplicate detection and brief packing.

The package imports ``notes`` and ``config`` only. It never runs Git or starts processes, makes no network call at
search time (the embedding model is a local file once downloaded), and prints nothing; ``hybrid.search`` is the entry
point (design section 7.4) and ``brief`` turns hits into the text of design section 7.2.
"""
