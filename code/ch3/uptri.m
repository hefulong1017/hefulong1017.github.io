function  x=uptri(A,b)
%---------------------------- General  M-file  comment
%  Version   :  V1.0
%  Coded by  :  song.yz
%  Date      :  2012-10-29 23:36:29          *星期一*
%-----------------------------------------------------
%  Parameters :
%       *.  A---系数矩阵
%       *.  b---右向量
%----------------------------------------------------
    N=length(b);
    x(N)=b(N)/A(N,N);

    for i=N-1:-1:1
        x(i)=b(i);
        for j=i+1:N
            x(i)=x(i)-A(i,j)*x(j);
        end
        x(i)=x(i)/A(i,i);
    end
    x=x';
end

