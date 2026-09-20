# Nationality lookup tables backing the RR4 (ร.ร.๔ hotel guest register) and
# TM30 (foreign-national arrival notification) exports.
#
# Both government forms need a nationality CODE, but the Connector API only
# gives Customer.NationalityCode as an ISO 3166-1 alpha-2 string. Neither
# form's code scheme is alpha-2, so these dicts translate alpha-2 -> the
# form's own code.
#
# Reconciled from the real "RR4-TM30-Chinatown-Gen" Google Sheet Chinatown's
# front desk already uses (2 tabs: RR4-Nationality, 259 rows; TM30-
# Nationality, 268 rows) against this codebase's existing alpha-2 -> English
# name map (_RR3_COUNTRY_MAP in sync_service.py), matching by normalized
# country name. Not every alpha-2 code resolved automatically - the source
# sheet is hand-maintained and has real gaps/typos (e.g. Greece's own row
# actually contains Greenland's data; North Korea's row is mislabeled
# "Korea (Republic of)", identical to South Korea's) - those handful of
# entries are corrected/added by hand below with their evidence.
#
# Coverage: RR4 195/249, TM30 227/249 of the alpha-2 codes in
# _RR3_COUNTRY_MAP. A code that isn't in these dicts renders as blank on the
# export rather than blocking the row - the same graceful degradation the
# source spreadsheet's own iferror(...,"Not found") uses.
#
# Audited 20-Sep-2026 against what MEWS actually returns: every distinct
# Customer.Nationality across 141,416 synced customer rows, 179 codes in all.
# The original seeding matched sheet rows to alpha-2 codes BY COUNTRY NAME,
# and most of what it missed was not absent from the sheet at all - those
# rows simply have an EMPTY "MEWS Nationality" column, so there was no name
# to match on ("SWAZI" for Eswatini, "SAMOAN" for Samoa, "THE KYRGYS
# REPUBLIC OF" [sic] for Kyrgyzstan). 17 such codes were recovered by reading
# the sheet's own rows directly; each carries its row's spelling as a comment
# where that spelling is why it was missed. Note the sheet's codes are NOT
# always ISO - Kosovo is RKS, Western Sahara S14, Virgin Islands VIS - so
# these have to be read off the sheet, never derived from ISO 3166.
#
# Two codes (RE, XK) were missing from _RR3_COUNTRY_MAP itself, which is
# worse than a missing nationality code: the RR4 address / come-from columns
# printed the bare alpha-2, AND the admin-editable tables join by country
# NAME, so no edit in Admin > RR4-Nationality could ever have reached them.
# Both added there.
#
# What is still unmapped, and why - all of it measured, none of it guesswork:
#   * OVERSEAS TERRITORIES have no nationality row of their own on the RR4
#     sheet, because the Thai Hotel Act form asks for สัญชาติ (nationality),
#     not country of residence. The sheet's own convention is to file them
#     under the SOVEREIGN state: row 50 is "Hong Kong | จีน(ฮ่องกง) |
#     HONGKONG | 44" (China's code) and row 110 is "British Indian Ocean
#     Territory | บริติช | British | 126" (Britain's). Both are already in
#     RR4_NATIONALITY_CODE. Extending that to MO/GU/AS/MP/PR/UM (-> 29 or
#     44), VG/IM/GG/JE (-> 126), NC/PF/GF/RE/MF (-> 5) and AW/SX (-> 3)
#     would be a reasonable reading, but it is an inference from two worked
#     examples rather than something the sheet states, so it is NOT applied
#     here - these render blank and someone should confirm the convention
#     before they don't.
#   * CI (Cote d'Ivoire) is genuinely absent from the RR4 sheet even though
#     it is a sovereign state - a gap in the source list, not in the join.
#   * DM (Dominica) is unmappable because the sheet CONTRADICTS ITSELF: row
#     79 reads "Dominican | โดมินิกัน | DOMINICAN | 178" and row 80 reads
#     "Dominican Republic | โดมินิกา | DOMINICA | 177" - the MEWS-name column
#     says 177 is the Dominican Republic while the Thai/English columns on
#     that same row say it is Dominica. DO -> 177 here follows the MEWS-name
#     column. Reading the other two columns instead would mean DM -> 177 and
#     DO -> 178. Same class of source defect as the Greece/Greenland swap
#     above; it needs a human decision, not a guess. A real guest hit this on
#     19-Sep-2026 (Patong room 3514) and filed with a blank nationality - as
#     did the property's own sheet, for the same reason.
#   * SX, IM, GG and JE have no row on EITHER sheet.
#
# Admin > RR4-Nationality was filled out to all 249 _RR3_COUNTRY_MAP names on
# 20-Sep-2026 (it held only the 192 that had a code), so every nationality
# MEWS can return is visible and editable there. The 54 with no Thai Hotel
# Act number yet carry a BLANK rr4_code, which _resolve_rr4_nationality_codes
# skips - an empty row cannot change what any export writes, it just gives
# someone a row to type the number into once it's known. That is why the
# admin table has more rows than this dict has entries.

# RR4-Nationality: alpha-2 -> Thai Hotel Act numeric nationality code.
RR4_NATIONALITY_CODE = {
    "AD": "120", "AE": "77", "AF": "100", "AG": "172", "AL": "119", "AM": "224",
    "AO": "128", "AR": "33", "AT": "11", "AU": "79", "AZ": "225", "BA": "234",
    "BB": "174", "BD": "64", "BE": "14", "BF": "131", "BG": "26", "BH": "101",
    "BI": "132", "BJ": "129", "BN": "69", "BO": "190", "BR": "34", "BS": "173",
    "BT": "102", "BW": "130", "BY": "233", "BZ": "175", "CA": "30", "CD": "138",
    "CF": "135", "CG": "138", "CH": "8", "CK": "246", "CL": "35", "CM": "133",
    "CN": "44", "CO": "37", "CR": "176", "CU": "32", "CV": "270", "CY": "28",
    "CZ": "18", "DE": "4", "DJ": "140", "DK": "6", "DO": "177", "DZ": "127",
    "EC": "191", "EE": "236", "EG": "74", "ER": "243", "ES": "15", "ET": "75",
    "FI": "13", "FJ": "111", "FM": "231", "FR": "5", "GA": "142", "GB": "126",
    "GD": "180", "GE": "226", "GH": "144", "GM": "143", "GN": "78", "GQ": "141",
    "GR": "20", "GT": "181", "GW": "145", "GY": "192", "HK": "44", "HN": "183",
    "HR": "221", "HT": "182", "HU": "19", "ID": "51", "IE": "12", "IL": "60",
    "IN": "45", "IO": "126", "IQ": "67", "IR": "62", "IS": "122", "IT": "9",
    "JM": "184", "JO": "103", "JP": "47", "KE": "73", "KG": "227", "KH": "57",
    "KI": "112", "KM": "137", "KN": "186",
    "KP": "104",  # own row confirmed ("เกาหลีเหนือ"/"THE DEMOCRATIC OF KOREA")
    "KR": "53", "KW": "68", "KZ": "223", "LA": "56", "LB": "61", "LC": "187",
    "LI": "123", "LK": "58", "LR": "147", "LS": "146", "LT": "238", "LU": "22",
    "LV": "237", "LY": "148", "MA": "154", "MC": "124", "MD": "240", "ME": "268",
    "MG": "149", "MH": "230", "MK": "239", "ML": "151",
    "MM": "48", "MN": "106",
    "MR": "152",  # "มอริเตเนีย"/"MAURITANTA" [sic]
    "MT": "24", "MU": "153", "MV": "105", "MW": "150", "MX": "31", "MY": "50",
    "MZ": "155", "NA": "244", "NE": "156", "NG": "76", "NI": "185", "NL": "3",
    "NO": "10", "NP": "55", "NR": "113", "NZ": "80", "OM": "107", "PA": "40",
    "PE": "39", "PG": "81", "PH": "49", "PK": "52", "PL": "17", "PS": "260",
    "PT": "2", "PW": "232", "PY": "193", "QA": "108", "RO": "27", "RS": "263",
    "RU": "16", "RW": "157", "SA": "59", "SB": "114", "SC": "160", "SD": "163",
    "SE": "7", "SG": "54", "SI": "242", "SK": "241", "SL": "161", "SM": "125",
    "SN": "159", "SO": "162", "SR": "194", "SS": "272", "SV": "179", "SY": "66",
    "SZ": "164",  # the sheet's row reads "สวาซี"/"SWAZI" - no "Eswatini" to match on
    "TD": "136", "TG": "166", "TH": "99", "TJ": "228", "TL": "261", "TM": "235",
    "TN": "167", "TO": "115", "TR": "63", "TT": "189", "TV": "116", "TW": "220",
    "TZ": "165", "UA": "216", "UG": "168", "US": "29", "UY": "41", "UZ": "229",
    "VE": "42", "VN": "46", "VU": "117",
    "WS": "118",  # the sheet's row reads "ซามัว"/"SAMOAN", not "Samoa"
    "XK": "271",  # the sheet DOES carry a "Kosovo" row; nothing here could
                  # reach it, because _RR3_COUNTRY_MAP had no XK to join on
    "YE": "109", "ZA": "70", "ZM": "170",
    "ZW": "171",
}

# TM30-Nationality: alpha-2 -> ISO 3166-1 alpha-3 (as prescribed by the form).
TM30_NATIONALITY_CODE = {
    "AD": "AND", "AE": "ARE", "AF": "AFG", "AG": "ATG", "AI": "AIA", "AL": "ALB",
    "AM": "ARM", "AO": "AGO", "AR": "ARG",
    "AS": "ASM",  # "AMERICA SAMOA" [sic]
    "AT": "AUT", "AU": "AUS", "AW": "AWB",
    "AZ": "AZE", "BA": "BIH", "BB": "BRB", "BD": "BGD", "BE": "BEL",
    "BF": "BFA",  # "BURKINAH FASO" [sic]
    "BG": "BGR", "BH": "BHR", "BI": "BDI", "BJ": "BEN", "BM": "BMU", "BN": "BRN",
    "BO": "BOL", "BR": "BRA", "BS": "BHS", "BT": "BTN", "BV": "BVT", "BW": "BWA",
    "BY": "BLR", "BZ": "BLZ", "CA": "CAN", "CC": "CCK", "CD": "COG", "CG": "COG",
    "CH": "CHE",
    "CI": "CIV",  # "Republic of Cote d'Ivoire" (curly apostrophe, missed by name-normalization)
    "CK": "COK", "CL": "CHL", "CM": "CMR", "CN": "CHN", "CO": "COL", "CR": "CRI",
    "CF": "CAF",  # "CENTRAL AFRICA REPUBLIC" [sic]
    "CU": "CUB", "CV": "CPV", "CX": "CXR", "CY": "CYP", "CZ": "CZE", "DE": "DEU",
    "DJ": "DJI", "DK": "DNK", "DM": "DMA", "DO": "DOM", "DZ": "DZA", "EC": "ECU",
    "EE": "EST", "EG": "EGY",
    "EH": "S14",  # "SPANISH SAHARA" - the form's own code, not ISO's ESH
    "ER": "ERI", "ES": "ESP", "ET": "ETH", "FI": "FIN",
    "FJ": "FJI", "FM": "FSM", "FR": "FRA", "GA": "GAB", "GB": "GBR", "GD": "GRD",
    "GE": "GEO", "GF": "GUF", "GH": "GHA", "GI": "GIB",
    "GM": "GMB",  # "THE ISLAM REPUBLIC OF THE GAMBIA" [sic]
    "GN": "GIN", "GP": "GLP", "GQ": "GNQ",
    "GR": "GRC",  # corrected: the sheet's "Greece"-labeled row actually contains Greenland's data (GRL) - see module docstring
    "GT": "GTM", "GU": "GUM", "GW": "GNB", "GY": "GUY", "HK": "HKG", "HN": "HND",
    "HR": "HRV", "HT": "HTI", "HU": "HUN", "ID": "IDN", "IE": "IRL", "IL": "ISR",
    "IN": "IND",
    "IO": "IOT",  # "BRITISH INDIAN OCEAN TERR."
    "IQ": "IRQ", "IR": "IRN", "IS": "ISL", "IT": "ITA", "JM": "JAM",
    "JO": "JOR", "JP": "JPN", "KE": "KEN",
    "KG": "KGZ",  # "THE KYRGYS REPUBLIC OF" [sic]
    "KH": "KHM", "KI": "KIR",
    "KN": "KNA",  # "ST.CHRISTOPHER/NEVIS"
    "KM": "COM",  # "THE ISIAMIC FEDERAL REPUBLIC OF THE COMOROS" [sic]
    "KP": "PRK",  # blank Mews-Nationality cell on its row; code confirmed directly
    "KR": "KOR", "KW": "KWT", "KY": "CYM", "KZ": "KAZ", "LA": "LAO", "LB": "LBN",
    "LC": "LCA", "LI": "LIE", "LK": "LKA", "LR": "LBR", "LS": "LSO", "LT": "LTU",
    "LU": "LUX", "LV": "LVA", "LY": "LBY", "MA": "MAR", "MC": "MCO", "MD": "MDA",
    "ME": "MNE", "MG": "MDG", "MH": "MHL", "MK": "MKD", "ML": "MLI", "MM": "MMR",
    "MN": "MNG", "MO": "MAC",
    "MP": "MNP",  # "MARIANA"
    "MQ": "MTQ", "MR": "MRT", "MS": "MSR", "MT": "MLT",
    "MU": "MUS", "MV": "MDV", "MW": "MWI", "MX": "MEX", "MY": "MYS", "MZ": "MOZ",
    "NA": "NAM",
    "NC": "NCL",  # "NEWCALEDONIA" [sic]
    "NE": "NER", "NF": "NFK", "NG": "NGA", "NI": "NIC", "NL": "NLD",
    "NO": "NOR", "NP": "NPL", "NR": "NRU", "NU": "NIU", "NZ": "NZL", "OM": "OMN",
    "PA": "PAN", "PE": "PER", "PF": "PYF", "PG": "PNG", "PH": "PHL", "PK": "PAK",
    "PL": "POL", "PN": "PCN",
    "PR": "PRI",  # "PUERTO RICA" [sic]
    "PS": "PLT", "PT": "PRT", "PW": "PLW", "PY": "PRY",
    "QA": "QAT",
    "RE": "REU",  # "REUNION ISLAND"
    "RO": "ROU", "RS": "SRB", "RU": "RUS",
    "RW": "RWA",  # "THE RWANDESE REPUBLIC"
    "SA": "SAU", "SB": "SLB",
    "SC": "SYC", "SD": "SDN", "SE": "SWE", "SG": "SGP", "SI": "SVN", "SK": "SVK",
    "SL": "SLE", "SM": "SMR", "SN": "SEN", "SO": "SOM", "SR": "SUR",
    "SS": "SSD",  # "REPUBLIC OF SOUTH SUDAN"
    "SV": "SLV", "SY": "SYR", "SZ": "SWZ", "TC": "TCA", "TD": "TCD", "TG": "TGO",
    "TH": "THA", "TJ": "TJK", "TK": "TKL", "TL": "TLS", "TM": "TKM", "TN": "TUN",
    "TO": "TON", "TR": "TUR", "TT": "TTO", "TV": "TUV", "TW": "TWN", "TZ": "TZA",
    "UA": "UKR", "UG": "UGA", "UM": "UMI", "US": "USA", "UY": "URY", "UZ": "UZB",
    "VC": "VCT", "VE": "VEN",
    "VG": "VIS",  # the sheet has ONE generic "VIRGIN ISLANDS" row (VIS,
                  # not ISO's VGB/VIR) and does not split British from US
    "VN": "VNM", "VU": "VUT", "WS": "WSM",
    "XK": "RKS",  # "REPUBLIC OF KOSOVO" - the widely-used non-ISO code
    "YE": "YEM",
    "YT": "MYT", "ZA": "ZAF", "ZM": "ZMB", "ZW": "ZIM",
}
