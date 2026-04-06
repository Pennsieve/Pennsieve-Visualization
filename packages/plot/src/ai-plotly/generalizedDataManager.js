import * as duckdb from "@duckdb/duckdb-wasm";

export class GeneralDataManager {
  constructor() {
    this.db = null;
    this.conn = null;
    this.initialized = false;
    this.catalog = null; // Store folder catalog
  }

  async initialize() {
    if (this.initialized) return;

    try {
      const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
      const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

      const worker_url = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], {
          type: "text/javascript",
        })
      );

      const worker = new Worker(worker_url);
      const logger = new duckdb.ConsoleLogger();

      this.db = new duckdb.AsyncDuckDB(logger, worker);
      await this.db.instantiate(bundle.mainModule);
      this.conn = await this.db.connect();

      // Load HTTPFS extension for S3/HTTPS support
      await this.conn.query(`INSTALL httpfs`);
      await this.conn.query(`LOAD httpfs`);

      this.initialized = true;
      console.log("✓ GeneralDataManager initialized");
    } catch (error) {
      console.error("Failed to initialize GeneralDataManager:", error);
      throw error;
    }
  }

  // Main query execution method
  async executeQuery(sql) {
    if (!this.initialized) {
      await this.initialize();
    }

    // Validate query
    const validation = await this.isValidQuery(sql);
    if (!validation.valid) {
      throw new Error(`Query validation failed: ${validation.error}`);
    }

    try {
      const result = await this.conn.query(sql);
      return result.toArray().map((row) => row.toJSON());
    } catch (error) {
      console.error("Query execution failed:", error);
      throw new Error(`Query failed: ${error.message}`);
    }
  }

  // Alias for compatibility
  async executeCustomQuery(sql) {
    return this.executeQuery(sql);
  }

  // Infer schema from a parquet file
  async inferSchema(parquetUrl, limit = 10) {
    const sql = `SELECT * FROM parquet_scan('${parquetUrl}') LIMIT ${limit}`;
    const sample = await this.executeQuery(sql);

    if (!sample || sample.length === 0) {
      throw new Error("No data found in parquet file");
    }

    return {
      columns: Object.keys(sample[0]),
      sampleData: sample,
      rowCount: sample.length,
    };
  }

  // Catalog all parquet files in a folder
  async catalogFolder(folderUrl, fileList) {
    console.log(`Cataloging ${fileList.length} files from manifest...`);

    const catalog = {
      folderUrl,
      files: [],
    };

    for (const fileName of fileList) {
      const fileUrl = `${folderUrl}/${fileName}`;

      try {
        console.log(`Scanning schema: ${fileName}`);

        // Direct query - fileUrl is from trusted manifest, not user input
        const schemaResult = await this.conn.query(`
        SELECT * FROM parquet_scan('${fileUrl}') LIMIT 0
        `);

        const schema = schemaResult.schema.fields.map((field) => ({
          name: field.name,
          type: field.type.toString(),
        }));

        // Get one sample row for context
        const sampleResult = await this.conn.query(`
          SELECT * FROM parquet_scan('${fileUrl}') LIMIT 1
        `);
        const sampleArray = sampleResult.toArray();
        const sample = sampleArray.length > 0 ? sampleArray[0].toJSON() : null;

        catalog.files.push({
          name: fileName,
          url: fileUrl,
          columns: schema,
          sampleRow: sample,
        });

        console.log(`✓ ${fileName}: ${schema.length} columns`);
      } catch (error) {
        console.warn(`Failed to scan ${fileName}:`, error.message);
        // Continue with other files
      }
    }

    this.catalog = catalog;
    return catalog;
  }

  // Generate AI-friendly catalog description
  getCatalogDescription() {
    if (!this.catalog) {
      return "No data catalog available";
    }

    let description = `Available parquet files in ${this.catalog.folderUrl}:\n\n`;

    for (const file of this.catalog.files) {
      description += `File: ${file.name}\n`;
      description += `Columns: ${file.columns
        .map((c) => `${c.name} (${c.type})`)
        .join(", ")}\n`;

      if (file.sampleRow) {
        description += `Sample: ${JSON.stringify(file.sampleRow, null, 2)}\n`;
      }

      description += `Full URL: ${file.url}\n\n`;
    }

    return description;
  }

  // Validate SQL query for security
  async isValidQuery(sql) {
    if (!sql) {
      return { valid: false, error: "Query is empty" };
    }

    const normalized = sql.toLowerCase().trim();
    const original = sql.trim();

    // 1. Must start with SELECT
    if (!normalized.startsWith("select")) {
      return {
        valid: false,
        error:
          "Query must start with SELECT. Only read operations are allowed.",
      };
    }

    // 2. Prohibited keywords (write/modify operations)
    const prohibited = [
      "drop",
      "delete",
      "insert",
      "update",
      "alter",
      "create",
      "truncate",
      "exec",
      "execute",
      "grant",
      "revoke",
    ];

    for (const keyword of prohibited) {
      const regex = new RegExp(`\\b${keyword}\\b`, "i");
      if (regex.test(normalized)) {
        return {
          valid: false,
          error: `Prohibited keyword detected: "${keyword}". Only SELECT queries are allowed.`,
        };
      }
    }

    // 3. Require LIMIT clause
    const limitMatch = normalized.match(/\blimit\s+(\d+)/i);
    if (!limitMatch) {
      return {
        valid: false,
        error:
          "Query must include a LIMIT clause (e.g., LIMIT 1000). Maximum allowed: 50000 rows.",
      };
    }

    const limitValue = parseInt(limitMatch[1], 10);
    if (limitValue > 50000) {
      return {
        valid: false,
        error: `LIMIT value ${limitValue} exceeds maximum allowed (50000). Please reduce the limit.`,
      };
    }

    if (limitValue <= 0) {
      return {
        valid: false,
        error: "LIMIT value must be greater than 0.",
      };
    }

    // 4. Validate parquet_scan() URLs
    const parquetMatches = original.match(
      /parquet_scan\s*\(\s*['"]([^'"]+)['"]\s*\)/gi
    );
    if (parquetMatches) {
      for (const match of parquetMatches) {
        const urlMatch = match.match(/['"]([^'"]+)['"]/);
        if (urlMatch) {
          const url = urlMatch[1];

          if (!this.isValidS3Url(url)) {
            return {
              valid: false,
              error: `Invalid parquet_scan() URL: "${url}". Only S3 URLs (s3://* or https://*.s3.amazonaws.com/*) are allowed.`,
            };
          }
        }
      }
    }

    // 5. Check subquery nesting depth (max 2 levels)
    const subqueryDepth = this.countSubqueryDepth(normalized);
    if (subqueryDepth > 2) {
      return {
        valid: false,
        error: `Query has ${subqueryDepth} levels of subqueries. Maximum allowed is 2 levels to prevent complexity attacks.`,
      };
    }

    // 6. Check for suspicious patterns
    const suspiciousPatterns = [
      {
        pattern: /;\s*select/i,
        message:
          "Multiple statements detected. Only single SELECT queries are allowed.",
      },
      {
        pattern: /\/\*.*\*\//s,
        message: "Block comments are not allowed in queries.",
      },
      {
        pattern: /--.*$/m,
        message: "Line comments are not allowed in queries.",
      },
      {
        pattern: /\binto\s+outfile\b/i,
        message: "INTO OUTFILE is not allowed.",
      },
      {
        pattern: /\bload_extension\b/i,
        message: "Loading extensions is not allowed.",
      },
      {
        pattern: /\bcopy\b/i,
        message: "COPY command is not allowed.",
      },
    ];

    for (const { pattern, message } of suspiciousPatterns) {
      if (pattern.test(normalized)) {
        return { valid: false, error: message };
      }
    }

    return { valid: true, error: null };
  }

  // Validate S3 URL format
  isValidS3Url(url) {
    return (
      url.startsWith("s3://") ||
      // Match: https://bucket-name.s3.region.amazonaws.com/...
      url.match(/^https?:\/\/[^/]+\.s3[.-][^/]+\.amazonaws\.com\//i) ||
      // Match: https://s3.region.amazonaws.com/bucket-name/...
      url.match(/^https?:\/\/s3[.-][^/]+\.amazonaws\.com\/[^/]+/i)
    );
  }

  // Count subquery nesting depth
  countSubqueryDepth(sql) {
    let depth = 0;
    let maxDepth = 0;
    let inString = false;
    let stringChar = null;

    for (let i = 0; i < sql.length; i++) {
      const char = sql[i];
      const prevChar = i > 0 ? sql[i - 1] : null;

      // Handle string literals
      if ((char === "'" || char === '"') && prevChar !== "\\") {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
          stringChar = null;
        }
      }

      // Count parentheses only outside of strings
      if (!inString) {
        if (char === "(") {
          const nextChars = sql.substring(i, i + 20).toLowerCase();
          if (nextChars.includes("select")) {
            depth++;
            maxDepth = Math.max(maxDepth, depth);
          }
        } else if (char === ")") {
          if (depth > 0) depth--;
        }
      }
    }

    return maxDepth;
  }

  // Cleanup
  async close() {
    if (this.conn) {
      await this.conn.close();
    }
    if (this.db) {
      await this.db.terminate();
    }
    this.initialized = false;
    this.catalog = null;
  }
}
