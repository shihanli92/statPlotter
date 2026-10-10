/*
 * Data: source data of Swaminathan, Gil, Bhattad et al., "Pyoderma gangrenosum caused by the
 * molecular uncoupling of OTULIN catalytic activity and LUBAC binding", Nature Immunology 27,
 * 1619–1632 (2026), https://doi.org/10.1038/s41590-026-02568-6, published open access under
 * CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Source data files MOESM20, 21, 24,
 * 25 and 28 (Figs 2c, 2e, 3f, 4b and 5b), one sheet each: every cell of the sheet as CSV (sheet
 * layout kept, the P values and the test the authors state beside the values too), numbers as
 * deposited. The example imports each as a user would import the workbook. Generated from the
 * workbooks; `ui/test/swamData.test.ts` checks every cell against them where they are on file.
 */

/** Where an embedded file comes from: a workbook and its sheet, every cell kept. */
export interface SwamSource {
  file: string
  sheet: string
}

export const SWAM_SOURCES: Record<string, SwamSource> = {
  '41590_2026_2568_MOESM20_ESM.csv': { file: '41590_2026_2568_MOESM20_ESM.xlsx', sheet: 'Sheet1' },
  '41590_2026_2568_MOESM21_ESM.csv': { file: '41590_2026_2568_MOESM21_ESM.xlsx', sheet: 'Sheet1' },
  '41590_2026_2568_MOESM24_ESM.csv': { file: '41590_2026_2568_MOESM24_ESM.xlsx', sheet: 'Sheet1' },
  '41590_2026_2568_MOESM25_ESM.csv': { file: '41590_2026_2568_MOESM25_ESM.xlsx', sheet: 'Sheet1' },
  '41590_2026_2568_MOESM28_ESM.csv': { file: '41590_2026_2568_MOESM28_ESM.xlsx', sheet: 'Sheet1' },
}

/** The embedded files by name, as `swamSourceFile` serves them. */
export const SWAM_FILES: Record<string, string> = {
  '41590_2026_2568_MOESM20_ESM.csv': `
,"Figure 2C. NF-kB promoter activity luciferase assay in HEK293T "
,Condition,Renilla + Firefly,,,,Renilla + Firefly + LUBAC,,,,WT,,,,D54A,,,,Y56F,,,,R57C,,,,L272P
,RLU (arbitrary units),Experiment 1,Experiment 2,Experiment 3,Experiment 4,Experiment 1,Experiment 2,Experiment 3,Experiment 4,Experiment 1,Experiment 2,Experiment 3,Experiment 4,Experiment 1,Experiment 2,Experiment 3,Experiment 4,Experiment 1,Experiment 2,Experiment 3,Experiment 4,Experiment 1,Experiment 2,Experiment 3,Experiment 4,Experiment 1,Experiment 2,Experiment 3,Experiment 4
,,1,1,1,1,25.8498007,8.84663066,4.21629385,9.81989211,1.457116,0.90490217,0.44511874,0.24847152,1.74568226,1.52172409,0.73478394,0.28081325,2.69384,3.83370718,0.64740418,0.67634142,1.68582939,1.00613015,0.22181907,0.24179363,53.5750263,15.2962915,5.03095108,11.8421353
,P-value to WT,,,,,,,,,,,,,ns,,,,ns,,,,ns,,,,<0.0001
,Statistical test,Two-tailed student's test comparing WT to respective genotype
`,
  '41590_2026_2568_MOESM21_ESM.csv': `
,Figure 2E. HOIP/OTULIN binding ratio in HEK293T
,Genotype,WT,,,,,D54A,,,,,Y56F,,,,,R57C,,,,,L272P
,HOIP/OTULIN ratio,Experiment 1,Experiment 2,Experiment 3,Experiment 4,Experiment 5,Experiment 1,Experiment 2,Experiment 3,Experiment 4,Experiment 5,Experiment 1,Experiment 2,Experiment 3,Experiment 4,Experiment 5,Experiment 1,Experiment 2,Experiment 3,Experiment 4,Experiment 5,Experiment 1,Experiment 2,Experiment 3,Experiment 4,Experiment 5
,,1.713929566,1.725931438,0.726216184,1.154950601,1.39398205,0.060154628,0.04,0.091873337,0.04,0.6917743,0.04,0.04,0.110915079,0.04,0.24053766,0.282112108,0.21305999,0.198551581,0.048465453,0.27158186,0.58704238,0.834930388,0.421911914,0.725507111,1.21475411
,P-value to WT,,,,,,,,,,,,,,,,0.0079,,,,,ns
,Statistical test,Two-tailed student's t-test comparing WT to respective genotype
`,
  '41590_2026_2568_MOESM24_ESM.csv': `
,"Figure 3F. Plasma concentration of IL-1B, IL-8, and TNF"
,Genotype,WT/WT,,,,,,,,,,,,,,,,,,,R57C/R57C,,,,P-value WT/WT vs R57C/R57C,Statistical test
,IL-1B,0.131347656,0.131347656,0.131347656,0.131347656,0.131347656,0.113037109,0.708496221,0.113037109,0.113037109,0.131347656,0.131347656,87.58777616,53.52691731,0.129615876,16.9010961,20.43705294,6.598018079,4.905570006,0.113037109,109.7407559,187.7182513,3861.561153,807.6840089,0.0031299492610822916,Two-tailed student's t-test
,IL-8,4.779442834,2.95754054,4.631350902,13.01474412,2.803496106,5.806089782,5.11886792,5.346303716,7.143102406,12.64987288,9.509861926,642.073668,540.264126,345.9955329,28.41766126,29.8355877,3496.432238,268.3057985,4.626284061,2331.988455,356.8394583,7600.457001,7039.401687,0.00009706431556923285,Two-tailed student's t-test
,TNF,3.30291258,2.95995618,3.074240686,2.734829275,2.748628936,1.844960553,2.956872585,2.571905474,2.600048831,3.127937759,2.911365457,5.614813641,4.045649394,3.343972429,3.889001991,3.661819438,8.661795603,3.403177299,2.828402448,6.810555952,4.930404521,2646.074051,156.750828,0.01684770818151634,Two-tailed student's t-test
`,
  '41590_2026_2568_MOESM25_ESM.csv': `
,Figure 4B. NLRP3 ASC inflammasome specks per nuclei in HEK293T
,Specks per nuclei,Empty vector,WT NLRP3,WT NLRP3 + WT OTULIN,WT NLRP3 + R57C OTULIN,WT NLRP3 + L272P OTULIN,D305N NLRP3
,Image 1,0,5.71428571,0,4.41176471,25.2631579,9.25925926
,Image 2,0,3.26797386,6.52173913,4.34782609,2.72727273,6.54205607
,Image 3,0,9.09090909,6.66666667,17.9487179,0,17.6470588
,Image 4,0,3.64963504,0,8.54700855,3.33333333,10.1449275
,Image 5,0,4.79452055,0,21.5384615,4.76190476,23.3333333
,Image 6,0,13.2352941,0.4587156,1.04166667,7.22891566,28.9855072
,Image 7,0,3.25581395,1.57480315,1.8957346,18.1818182,19.3277311
,Image 8,0,2.49221184,0,5.32544379,5.55555556,6.75675676
,Image 9,0,6.92307692,1.0989011,3.22580645,0,8.90410959
,Image 10,0,2.46305419,1.14942529,18.75,11.25,9.64912281
,Image 11,0,2.15827338,0,10.5263158,11.1111111,6.25
,Image 12,0,1.58730159,0,15.3846154,34.4827586,15.3846154
,Image 13,0,4.72440945,6.89655172,22.2222222,6.54205607,18.1818182
,Image 14,0,0,0,8.33333333,2.43902439
,Image 15,0,1.92307692,4.65116279,2.17391304,2.29007634
,p-value to WT NLRP3 + WT OTULIN,n/a,0.0393360842632551,n/a,0.0007972294910307525,0.012438987065883249,n/a
,Statistical test,Two-tailed student's t-test
`,
  '41590_2026_2568_MOESM28_ESM.csv': `
,"Figure 5B. Kinetic microscopy Propidium Iodide uptake by WT, NT, KO, and genetically complemented N/TERT-1 at 72hr (+/- TNF)"
,Genotype + condition,WT,WT+TNF,NT,NT+TNF,KO,KO+TNF,WT complementation,WT complementation+TNF,R57C complementation,R57C complementation+TNF,L272P complementation,L272P complementation+TNF
,Experiment 1,818,238,575,1251.66667,3667.66667,10309.6667,492,1642,2102.33333,9524,664.333333,5008.66667
,Experiment 2,57.6666667,21.3333333,78.3333333,162.333333,26,2236,59,758.666667,1032.33333,3170.33333,799,5644.33333
,Experiment 3,127.5,56,61.6666667,321.666667,2009.33333,7442,661.333333,2090.33333,5292.66667,9680,1964.66667,12047.6667
,Experiment 4,1,1,1,22.3333333,833.666667,3823,135,953,1258,4041,441,5174.66667
,P-value to WT+TNF,n/a,n/a,n/a,n/a,n/a,0.017823410627541864,n/a,0.006385892332952387,n/a,0.009541006384541629,n/a,0.006689557334105091
,P-value to WT complementation+TNF,n/a,n/a,n/a,n/a,n/a,n/a,n/a,n/a,n/a,0.02507759057257131,n/a,0.017488883830164118
,Statistical test,Two-tailed student's t-test
`,
}
