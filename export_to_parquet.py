import os
import sqlite3
import argparse
from datetime import datetime

def export_table_to_parquet(table_name, date_str, output_folder):
    db_path = os.path.join("backend", "database", "market_data.db")
    if not os.path.exists(db_path):
        print(f"Error: Database not found at {db_path}")
        return

    try:
        import pandas as pd
    except ImportError:
        print("Error: pandas is not installed. Please run: pip install pandas pyarrow")
        return

    try:
        import pyarrow
    except ImportError:
        print("Error: pyarrow is not installed. Please run: pip install pyarrow")
        return

    conn = sqlite3.connect(db_path)
    
    # Check if table exists
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table_name,))
    if not cursor.fetchone():
        print(f"Error: Table '{table_name}' does not exist in the database.")
        conn.close()
        return

    print(f"Reading table '{table_name}' for date '{date_str}'...")
    
    query = f"SELECT * FROM {table_name}"
    params = []
    if table_name != "system_logs" and date_str:
        query += " WHERE trading_date = ?"
        params.append(date_str)
        
    df = pd.read_sql_query(query, conn, params=params)
    conn.close()

    if df.empty:
        print("No records found to export.")
        return

    # Ensure output folder exists
    os.makedirs(output_folder, exist_ok=True)
    filename = f"{table_name}_{date_str or 'all'}.parquet"
    output_path = os.path.join(output_folder, filename)

    print(f"Writing {len(df)} rows to {output_path}...")
    df.to_parquet(output_path, index=False)
    print("Export complete!")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Export Intraday Market Data from SQLite to Apache Parquet")
    parser.add_argument("--table", type=str, default="market_snapshots", 
                        choices=["market_snapshots", "option_chain_snapshots", "market_breadth", "sector_strength", "trade_signals", "system_logs"],
                        help="Table to export")
    parser.add_argument("--date", type=str, default=datetime.now().strftime("%Y-%m-%d"),
                        help="Trading date to export (YYYY-MM-DD). If empty/all, exports all records.")
    parser.add_argument("--out", type=str, default="backend/database/exports",
                        help="Output directory for the Parquet files")

    args = parser.parse_args()
    export_table_to_parquet(args.table, args.date, args.out)
