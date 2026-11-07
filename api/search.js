
export default async function handler(req, res) {

    // =====================================
    // 1. 요청값 확인
    // =====================================

    if (req.method !== "GET") {
        return res.status(405).json({
            success: false,
            error: "GET 요청만 허용됩니다."
        });
    }

    const corpName = String(req.query.corpName || "").trim();
    const address = String(req.query.address || "").trim();

    if (!corpName) {
        return res.status(400).json({
            success: false,
            error: "상호명을 입력해 주세요."
        });
    }

    const apiKey = process.env.DATA_GO_KR_API_KEY;
    const ntsApiKey = process.env.NTS_API_KEY;

    if (!apiKey) {
        return res.status(500).json({
            success: false,
            error: "금융위원회 API 인증키가 설정되지 않았습니다."
        });
    }


    // =====================================
    // 2. 번호 표시 형식
    // =====================================

    function formatBizNo(value) {
        const number = String(value || "").replace(/\D/g, "");

        if (number.length !== 10) return value || "정보없음";

        return number.replace(
            /^(\d{3})(\d{2})(\d{5})$/,
            "$1-$2-$3"
        );
    }

    function formatCorpNo(value) {
        const number = String(value || "").replace(/\D/g, "");

        if (number.length !== 13) return value || "정보없음";

        return number.replace(
            /^(\d{6})(\d{7})$/,
            "$1-$2"
        );
    }


    // =====================================
    // 3. 기업명 및 주소 정규화
    // =====================================

    function normalize(value) {
        return String(value || "")
            .replace(/주식회사|㈜|\(주\)|주\)/g, "")
            .replace(/\s/g, "")
            .replace(/[()（）]/g, "")
            .toLowerCase();
    }

    function matchAddress(companyAddress, searchAddress) {
        if (!searchAddress) return false;

        const company = normalize(companyAddress);

        const keywords = searchAddress
            .split(/\s+/)
            .filter(Boolean)
            .map(normalize);

        return keywords.length > 0 &&
            keywords.every(keyword => company.includes(keyword));
    }


    try {

        // =====================================
        // 4. 금융위원회 기업기본정보 API
        // =====================================

        const baseUrl =
            "https://apis.data.go.kr/1160100/service/GetCorpBasicInfoService_V2/getCorpOutline_V2";

        const params = new URLSearchParams({
            serviceKey: apiKey,
            resultType: "json",
            pageNo: "1",
            numOfRows: "20",
            corpNm: corpName
        });

        const response = await fetch(
            `${baseUrl}?${params.toString()}`
        );

        const rawText = await response.text();

        if (!response.ok) {
            return res.status(502).json({
                success: false,
                error: `금융위원회 HTTP 오류: ${response.status}`,
                detail: rawText.substring(0, 500)
            });
        }

        let data;

        try {
            data = JSON.parse(rawText);
        } catch {
            return res.status(502).json({
                success: false,
                error: "금융위원회 응답이 JSON 형식이 아닙니다.",
                detail: rawText.substring(0, 500)
            });
        }

        const header = data?.response?.header;

        if (!header || header.resultCode !== "00") {
            return res.status(502).json({
                success: false,
                error: "금융위원회 API 오류",
                resultCode: header?.resultCode || "확인불가",
                resultMsg: header?.resultMsg || "응답 헤더가 없습니다."
            });
        }


        // =====================================
        // 5. 기업 검색 결과 처리
        // =====================================

        const body = data?.response?.body;
        const items = body?.items?.item;

        let itemList = [];

        if (Array.isArray(items)) {
            itemList = items;
        } else if (items) {
            itemList = [items];
        }

        const totalCount = Number(body?.totalCount || 0);

        if (itemList.length === 0) {
            return res.status(200).json({
                success: false,
                error: "해당 상호명으로 등록된 기업정보가 없습니다.",
                corpName: corpName
            });
        }


        // =====================================
        // 6. 상호명 + 주소로 기업 후보 선택
        // =====================================

        const searchName = normalize(corpName);

        const rankedItems = itemList.map(item => {

            const companyName = normalize(item.corpNm);
            const companyAddress = item.enpBsadr || "";

            let score = 0;

            if (companyName === searchName) {
                score += 100;
            } else if (
                companyName.includes(searchName) ||
                searchName.includes(companyName)
            ) {
                score += 50;
            }

            if (address && matchAddress(companyAddress, address)) {
                score += 30;
            }

            return {
                item,
                score
            };

        });

        rankedItems.sort((a, b) => b.score - a.score);

        const target = rankedItems[0].item;


        // =====================================
        // 7. 사업자등록번호 원본 확보
        // =====================================

        const businessNumber = String(target.bzno || "")
            .replace(/\D/g, "");

        let ntsStatus = "국세청 조회 필요";
        let ntsEndDate = "";
        let ntsError = "";


        // =====================================
        // 8. 국세청 사업자 상태조회 API
        // =====================================

        if (!ntsApiKey) {

            ntsStatus = "국세청 인증키 미설정";

        } else if (!/^\d{10}$/.test(businessNumber)) {

            ntsStatus = "사업자등록번호 형식 오류";

        } else {

            try {

                const ntsUrl = new URL(
                    "https://api.odcloud.kr/api/nts-businessman/v1/status"
                );

                ntsUrl.searchParams.set(
                    "serviceKey",
                    ntsApiKey
                );

                const ntsResponse = await fetch(
                    ntsUrl.toString(),
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Accept": "application/json"
                        },
                        body: JSON.stringify({
                            b_no: [businessNumber]
                        })
                    }
                );

                const ntsText = await ntsResponse.text();

                if (!ntsResponse.ok) {
                    throw new Error(
                        `국세청 HTTP 오류 ${ntsResponse.status}: ${ntsText.substring(0, 300)}`
                    );
                }

                const ntsData = JSON.parse(ntsText);

                // 사업자번호를 기준으로 응답 데이터 확인
                const resultList = ntsData?.data || [];

                const ntsResult = resultList.find(item =>
                    String(item.b_no || "").replace(/\D/g, "") === businessNumber
                );

                if (!ntsResult) {

                    ntsStatus = "국세청 조회 결과 없음";

                } else if (ntsResult.b_stt_cd === "01") {

                    ntsStatus = "계속사업자";

                } else if (ntsResult.b_stt_cd === "02") {

                    ntsStatus = "휴업자";

                } else if (ntsResult.b_stt_cd === "03") {

                    ntsStatus = "폐업자";

                } else {

                    ntsStatus =
                        ntsResult.tax_type ||
                        "국세청 등록정보 확인 필요";

                }

                // 폐업일자
                if (ntsResult?.end_dt) {

                    const endDate = String(ntsResult.end_dt);

                    if (/^\d{8}$/.test(endDate)) {
                        ntsEndDate =
                            `${endDate.substring(0, 4)}-` +
                            `${endDate.substring(4, 6)}-` +
                            `${endDate.substring(6, 8)}`;
                    }
                }

            } catch (error) {

                console.error("국세청 API 오류:", error);

                ntsStatus = "국세청 조회 오류";
                ntsError = error.message;

            }
        }


        // =====================================
        // 9. 최종 기업정보 반환
        // =====================================

        return res.status(200).json({

            success: true,

            corpName:
                target.corpNm || corpName,

            ceoNm:
                target.enpRprFnm || "정보없음",

            // 화면 표시용 하이픈 적용
            bizno:
                formatBizNo(businessNumber),

            crno:
                formatCorpNo(target.crno),

            phone:
                target.enpTlno || "정보없음",

            address:
                target.enpBsadr || "정보없음",

            // 국세청 실제 조회 결과
            status:
                ntsStatus,

            endDate:
                ntsEndDate,

            ntsError:
                ntsError,

            totalCount:
                totalCount,

            returnedCount:
                itemList.length,

            source:
                "금융위원회 + 국세청"

        });

    } catch (error) {

        console.error("기업정보 조회 오류:", error);

        return res.status(500).json({
            success: false,
            error: "서버 통신 실패",
            detail: error.message
        });

    }

}

