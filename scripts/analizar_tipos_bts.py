import pandas as pd, glob

bts = pd.concat(pd.read_csv(f, usecols=["TAIL_NUM"]) for f in glob.glob("raw_data/bts*.csv"))
vuelos_por_matricula = bts["TAIL_NUM"].value_counts().rename("vuelos")

osk = pd.read_csv("raw_data/aircraft-database-complete-2025-08.csv", quotechar="'",
                  usecols=["registration", "typecode", "manufacturerName", "model"],
                  low_memory=False)
osk = osk.drop_duplicates("registration").set_index("registration")

df = osk.join(vuelos_por_matricula, how="inner")
top = (df.groupby("typecode")["vuelos"].sum()
         .sort_values(ascending=False).head(60))
print(f"Matrículas BTS: {len(vuelos_por_matricula)} | con match en OpenSky: {len(df)}")
print(top.to_string())